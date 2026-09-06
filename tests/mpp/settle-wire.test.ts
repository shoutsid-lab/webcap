import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hexlify, randomBytes, Signature, Wallet } from 'ethers';
import type { FastifyInstance } from 'fastify';
import { decodePaymentResponseHeader } from '@x402/core/http';
import { openDb, type Db } from '../../src/db/index.js';
import { makeArtifactRepo } from '../../src/db/artifacts.js';
import { makeRevenueRepo } from '../../src/db/revenue.js';
import type { WebcapConfig } from '../../src/config.js';
import { buildApp } from '../../src/server/server.js';
import { FAKE_PNG } from '../api/fixture.js';
import { makeMockFacilitator, type MockFacilitator } from '../helpers/facilitator.js';

// Sepolia terms (mirrors tests/e2e/x402.capture.test.ts + tests/mpp/header.test.ts).
const SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const MERCHANT_ADDRESS = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';
const MPP_SECRET = 'ab'.repeat(32); // 64 bare-hex chars -> 32 bytes, enables MPP
const PUBLIC_BASE_URL = 'http://localhost:8080';
const CAPTURE_UNITS = 1_000;
const PAYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b786900';
// Sepolia USDC EIP-712 domain (EIP712_DOMAINS['eip155:84532'] in src/config/chains.ts).
const EIP712 = { name: 'USDC', version: '2', chainId: 84532 } as const;

const TRANSFER_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

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
    x402ExtractPriceUsdcUnits: 10_000,
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
    capture: async () => ({ buffer: FAKE_PNG, format: 'png', bytes: FAKE_PNG.length }),
    captureStructured: async () => {
      throw new Error('must not structure on a capture wire test');
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

function wwwAuthenticateOf(res: { headers: Record<string, unknown> }): string {
  const header = res.headers['www-authenticate'];
  if (typeof header !== 'string' || header === '') throw new Error('WWW-Authenticate header missing');
  return header;
}

function challengeIdOf(header: string): string {
  const match = /id="([^"]+)"/.exec(header);
  if (match?.[1] === undefined) throw new Error('challenge has no id');
  return match[1];
}

/** A live MPP credential for the given challenge id, signed over the sepolia terms. */
async function authorizationHeader(challengeId: string, value = String(CAPTURE_UNITS)): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const signer = new Wallet(PAYER_KEY);
  const message = {
    from: signer.address,
    to: MERCHANT_ADDRESS,
    value: BigInt(value),
    validAfter: BigInt(now - 10),
    validBefore: BigInt(now + 600),
    nonce: hexlify(randomBytes(32)),
  };
  const signature = await signer.signTypedData(
    { name: EIP712.name, version: EIP712.version, chainId: EIP712.chainId, verifyingContract: SEPOLIA_USDC },
    TRANSFER_TYPES,
    message,
  );
  const sig = Signature.from(signature);
  const credential = {
    from: message.from,
    to: message.to,
    value: message.value.toString(),
    validAfter: message.validAfter.toString(),
    validBefore: message.validBefore.toString(),
    nonce: message.nonce,
    v: sig.v,
    r: sig.r,
    s: sig.s,
    challengeId,
  };
  return `Payment credential="${Buffer.from(JSON.stringify(credential), 'utf8').toString('base64url')}"`;
}

/** The pinned x402-only 402 body: same request against the MPP-disabled app. */
async function x402OnlyBodySha(url: string): Promise<{ status: number; sha: string }> {
  const res = await disabled.inject({ method: 'POST', url, payload: { url: 'https://example.com' } });
  expect(res.statusCode).toBe(402);
  return { status: res.statusCode, sha: sha256Hex(res.body) };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'webcap-mpp-wire-'));
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

describe('mpp settle wiring: a valid Authorization credential settles the live flow once', () => {
  it('POST /v1/x402/capture with a live-challenge credential returns 200 settled exactly once', async () => {
    const payer = new Wallet(PAYER_KEY).address;
    const unpaid = await enabled.inject({
      method: 'POST',
      url: '/v1/x402/capture',
      payload: { url: 'https://example.com' },
    });
    expect(unpaid.statusCode).toBe(402);
    const authorization = await authorizationHeader(challengeIdOf(wwwAuthenticateOf(unpaid)));

    const before = { ...mock.calls };
    const revenueBefore = makeRevenueRepo(db).summary().requestCount;
    const paid = await enabled.inject({
      method: 'POST',
      url: '/v1/x402/capture',
      payload: { url: 'https://example.com' },
      headers: { authorization },
    });
    expect(paid.statusCode).toBe(200);
    const body = paid.json() as { artifact: { format: string }; payment: { payer: string; priceUsdcUnits: number } };
    expect(body.payment.payer).toBe(payer);
    expect(body.payment.priceUsdcUnits).toBe(CAPTURE_UNITS);
    expect(body.artifact.format).toBe('png');
    // Exactly ONE settlement for the request: the hook settles, x402 onSend must not re-settle.
    expect(mock.calls.settle).toBe(before.settle + 1);
    expect(mock.settlements[mock.settlements.length - 1]?.requirements.amount).toBe(String(CAPTURE_UNITS));
    // Revenue recorded with the MPP payer attached.
    const recent = makeRevenueRepo(db).recent(1)[0];
    expect(makeRevenueRepo(db).summary().requestCount).toBe(revenueBefore + 1);
    expect(recent?.endpoint).toBe('capture');
    expect(recent?.payer).toBe(payer);
    // The 200 carries a decodable settlement receipt like an x402 payment.
    const settled = decodePaymentResponseHeader(String(paid.headers['payment-response']));
    expect(settled.success).toBe(true);
    expect(settled.payer).toBe(payer);
  });
});

describe('mpp settle wiring: invalid/absent credentials fall through to the x402 402 unchanged', () => {
  it('a tampered credential (wrong value) is 402 with zero settles and a byte-identical body', async () => {
    const unpaid = await enabled.inject({
      method: 'POST',
      url: '/v1/x402/capture',
      payload: { url: 'https://example.com' },
    });
    expect(unpaid.statusCode).toBe(402);
    const authorization = await authorizationHeader(challengeIdOf(wwwAuthenticateOf(unpaid)), '999');

    const before = { ...mock.calls };
    const pinned = await x402OnlyBodySha('/v1/x402/capture');
    const res = await enabled.inject({
      method: 'POST',
      url: '/v1/x402/capture',
      payload: { url: 'https://example.com' },
      headers: { authorization },
    });
    expect(res.statusCode).toBe(402);
    expect(mock.calls.settle).toBe(before.settle);
    expect(sha256Hex(res.body)).toBe(pinned.sha);
  });

  it('an absent credential is 402 unchanged (zero facilitator calls)', async () => {
    const before = { ...mock.calls };
    const pinned = await x402OnlyBodySha('/v1/x402/capture');
    const res = await enabled.inject({
      method: 'POST',
      url: '/v1/x402/capture',
      payload: { url: 'https://example.com' },
    });
    expect(res.statusCode).toBe(402);
    expect(mock.calls.verify).toBe(before.verify);
    expect(mock.calls.settle).toBe(before.settle);
    expect(sha256Hex(res.body)).toBe(pinned.sha);
  });
});
