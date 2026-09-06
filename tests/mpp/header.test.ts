import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDb, type Db } from '../../src/db/index.js';
import { makeArtifactRepo } from '../../src/db/artifacts.js';
import type { WebcapConfig } from '../../src/config.js';
import { buildApp } from '../../src/server/server.js';
import { parseWwwAuthenticate } from '../../src/mpp/challenge.js';
import { makeMockFacilitator, type MockFacilitator } from '../helpers/facilitator.js';

const SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const MERCHANT_ADDRESS = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';
const MPP_SECRET = 'ab'.repeat(32); // 64 bare-hex chars -> 32 bytes, enables MPP
const PUBLIC_BASE_URL = 'http://localhost:8080';
const REALM = 'localhost:8080';

const CAPTURE_UNITS = 1_000;
const EXTRACT_UNITS = 10_000;
const TOPUP_FALLBACK_UNITS = CAPTURE_UNITS * 100;

function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

function makeConfig(): WebcapConfig {
  return {
    chain: {
      name: 'base-sepolia',
      rpcUrl: 'https://sepolia.base.org',
      chainId: 84532,
      usdcContract: SEPOLIA_USDC,
      explorer: 'https://sepolia.basescan.org',
    },
    chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
    usdcAddress: SEPOLIA_USDC,
    merchantAddress: MERCHANT_ADDRESS,
    port: 0,
    pollIntervalMs: 5_000,
    merchantPrivateKey: '',
    dbPath: join(dir, 'x402.db'),
    x402Network: 'eip155:84532',
    x402Asset: SEPOLIA_USDC,
    x402PayTo: MERCHANT_ADDRESS,
    x402PriceUsdcUnits: CAPTURE_UNITS,
    x402ExtractPriceUsdcUnits: EXTRACT_UNITS,
    x402AuditPriceUsdcUnits: 2_000,
    x402VideoPriceUsdcUnits: 5_000,
    computeCostUsdcUnitsPerRequest: 200,
    modelApiBaseUrl: '',
    modelApiKey: '',
    modelName: '',
    x402FacilitatorUrl: 'https://x402.org/facilitator',
    publicBaseUrl: PUBLIC_BASE_URL,
    cdpApiKey: undefined,
  };
}

function buildTestApp(): FastifyInstance {
  return buildApp({
    db,
    config: makeConfig(),
    capture: async () => {
      throw new Error('must not capture on an unpaid 402');
    },
    captureStructured: async () => {
      throw new Error('must not capture on an unpaid 402');
    },
    og: async ({ url }) => ({ url, title: 'Stub' }),
    x402Facilitator: mock.facilitator,
    artifacts: makeArtifactRepo(db),
  });
}

let dir: string;
let db: Db;
let mock: MockFacilitator;
let enabled: FastifyInstance;
let disabled: FastifyInstance;

interface PaidCase {
  readonly name: string;
  readonly method: 'POST' | 'GET';
  readonly url: string;
  /** Expected atomic USDC units bound into the MPP challenge request payload. */
  readonly expectedUnits: number;
}

const PAID_CASES: readonly PaidCase[] = [
  { name: 'POST capture', method: 'POST', url: '/v1/x402/capture', expectedUnits: CAPTURE_UNITS },
  { name: 'GET capture', method: 'GET', url: '/v1/x402/capture', expectedUnits: CAPTURE_UNITS },
  { name: 'POST extract', method: 'POST', url: '/v1/x402/extract', expectedUnits: EXTRACT_UNITS },
  { name: 'GET extract', method: 'GET', url: '/v1/x402/extract', expectedUnits: EXTRACT_UNITS },
  {
    name: 'POST topup (no watch -> capture-pack fallback)',
    method: 'POST',
    url: '/v1/x402/watches/topup?watchId=missing',
    expectedUnits: TOPUP_FALLBACK_UNITS,
  },
  {
    name: 'GET topup (no watch -> capture-pack fallback)',
    method: 'GET',
    url: '/v1/x402/watches/topup?watchId=missing',
    expectedUnits: TOPUP_FALLBACK_UNITS,
  },
];

function wwwAuthenticateOf(res: { headers: Record<string, unknown> }): string {
  const header = res.headers['www-authenticate'];
  if (typeof header !== 'string' || header === '') throw new Error('WWW-Authenticate header missing');
  return header;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'webcap-mpp-header-'));
  db = openDb(join(dir, 'x402.db'));
  mock = makeMockFacilitator('eip155:84532');
  process.env.MPP_SECRET_KEY = MPP_SECRET;
  enabled = buildTestApp();
  delete process.env.MPP_SECRET_KEY;
  disabled = buildTestApp();
});

afterAll(async () => {
  await enabled.close();
  await disabled.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MPP_SECRET_KEY;
});

describe('mpp 402 header (dual-protocol challenge)', () => {
  for (const paid of PAID_CASES) {
    it(`${paid.name}: unpaid 402 carries BOTH challenges and byte-identical body`, async () => {
      const res = await enabled.inject({ method: paid.method, url: paid.url, payload: { url: 'https://example.com' } });
      expect(res.statusCode).toBe(402);
      // x402 challenge unchanged.
      expect(typeof res.headers['payment-required']).toBe('string');
      // MPP challenge present and well-formed.
      const header = wwwAuthenticateOf(res);
      expect(header).toContain('method="evm"');
      const parsed = parseWwwAuthenticate(header);
      expect(parsed.realm).toBe(REALM);
      expect(parsed.method).toBe('evm');
      expect(parsed.intent).toBe('charge');
      // The bound request prices IDENTICALLY to x402 (atomic units -> 6dp USD).
      const requestJson = JSON.parse(Buffer.from(parsed.request, 'base64url').toString('utf8')) as {
        amount: string;
        currency: string;
        recipient: string;
        methodDetails: { chainId: number };
      };
      expect(requestJson.amount).toBe((paid.expectedUnits / 1_000_000).toFixed(6));
      expect(requestJson.currency).toBe('USD');
      expect(requestJson.recipient).toBe(MERCHANT_ADDRESS);
      expect(requestJson.methodDetails.chainId).toBe(84532);
      // Body bytes untouched: sha256 pin equals the MPP-disabled response.
      const plain = await disabled.inject({ method: paid.method, url: paid.url, payload: { url: 'https://example.com' } });
      expect(plain.statusCode).toBe(402);
      expect(plain.headers['payment-required']).toBe(res.headers['payment-required']);
      expect(sha256Hex(res.body)).toBe(sha256Hex(plain.body));
    });
  }

  it('MPP disabled (no MPP_SECRET_KEY) = no-op passthrough, zero header change', async () => {
    const res = await disabled.inject({ method: 'POST', url: '/v1/x402/capture', payload: { url: 'https://example.com' } });
    expect(res.statusCode).toBe(402);
    expect(typeof res.headers['payment-required']).toBe('string');
    expect(res.headers['www-authenticate']).toBeUndefined();
  });

  it('non-402 responses carry no MPP challenge', async () => {
    const res = await enabled.inject({ method: 'GET', url: '/v1/x402/service' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['www-authenticate']).toBeUndefined();
  });
});
