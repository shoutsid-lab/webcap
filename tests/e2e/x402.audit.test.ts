import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import axios from 'axios';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { openDb, type Db } from '../../src/db/index.js';
import { makeArtifactRepo } from '../../src/db/artifacts.js';
import type { WebcapConfig } from '../../src/config.js';
import { buildApp } from '../../src/server/server.js';
import { CaptureError } from '../../src/capture/errors.js';
import type { CaptureRequest, PageStructure, StructuredCapture } from '../../src/capture/pipeline.js';
import { makeMockFacilitator, type MockFacilitator } from '../helpers/facilitator.js';
import { closeApiFixture, makeApiFixture } from '../api/fixture.js';
import { privateKeyToAccount } from 'viem/accounts';
import { ExactEvmScheme } from '@x402/evm';
import { x402Client, wrapAxiosWithPayment } from '@x402/axios';

const SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const MERCHANT_ADDRESS = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';
const PAYER_KEY_A = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b786900';
const GOOD_URL = 'https://example.com/';

let dir: string;
let db: Db;
let app: FastifyInstance;
let baseUrl: string;
let mock: MockFacilitator;
const failingUrls = new Set<string>();
const structuredCalls: string[] = [];

function structureFor(url: string): PageStructure {
  return {
    title: `Title of ${url}`,
    description: `Description of ${url}`,
    headings: [{ level: 1, text: `Heading from ${url}` }],
    paragraphs: [`Body text for ${url}.`],
    links: [{ href: url, text: 'self' }],
    images: [],
    wordCount: 5,
    markdown: `# Heading from ${url}\n\nBody text for ${url}.`,
  };
}

const fakeCaptureStructured = async (req: CaptureRequest): Promise<StructuredCapture> => {
  structuredCalls.push(req.url);
  if (failingUrls.has(req.url)) throw new CaptureError(`structured capture failed for ${req.url}: boom`);
  return {
    html: `<html><head><title>Title of ${req.url}</title><meta name="description" content="Description of ${req.url}"></head><body><h1>Heading from ${req.url}</h1><a href="${req.url}">self</a></body></html>`,
    structure: structureFor(req.url),
  };
};

function makePayer() {
  const account = privateKeyToAccount(PAYER_KEY_A);
  return { account, client: new x402Client().register('eip155:*', new ExactEvmScheme(account)) };
}

async function paidAudit(payload: unknown) {
  const { client } = makePayer();
  const api = wrapAxiosWithPayment(axios.create({ baseURL: baseUrl }), client);
  return api.post('/v1/x402/audit', payload);
}

function responseOf(err: unknown): { status?: number; code?: string } {
  const response = (err as { response?: { status?: number; data?: { error?: { code?: string } } } }).response;
  return { status: response?.status, code: response?.data?.error?.code };
}

function ledgerRows(): Array<{ endpoint: string; revenue_usdc: number; cost_usdc: number; net_margin_usdc: number; payer: string }> {
  return db
    .prepare<[], { endpoint: string; revenue_usdc: number; cost_usdc: number; net_margin_usdc: number; payer: string }>(
      'SELECT endpoint, revenue_usdc, cost_usdc, net_margin_usdc, payer FROM revenue_ledger',
    )
    .all();
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'webcap-x402-audit-'));
  db = openDb(join(dir, 'x402-audit.db'));
  mock = makeMockFacilitator('eip155:84532');
  const config: WebcapConfig = {
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
    dbPath: join(dir, 'x402-audit.db'),
    x402Network: 'eip155:84532',
    x402Asset: SEPOLIA_USDC,
    x402PayTo: MERCHANT_ADDRESS,
    x402PriceUsdcUnits: 1_000,
    x402ExtractPriceUsdcUnits: 10_000,
    x402AuditPriceUsdcUnits: 2000,
    computeCostUsdcUnitsPerRequest: 200,
    modelApiBaseUrl: '',
    modelApiKey: '',
    modelName: '',
    x402FacilitatorUrl: 'https://x402.org/facilitator',
    publicBaseUrl: 'http://localhost:8080',
    cdpApiKey: undefined,
  };
  app = buildApp({
    db,
    config,
    capture: async () => {
      throw new Error('capture is not used in audit tests');
    },
    captureStructured: fakeCaptureStructured,
    og: async ({ url }) => ({ url, title: 'Stub' }),
    x402Facilitator: mock.facilitator,
    artifacts: makeArtifactRepo(db),
  });
  baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
});

afterAll(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('x402 audit (v2 wire, mock facilitator, no chain)', () => {
  it('A1: an unpaid audit returns 402 at the audit price, not the capture price', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/x402/audit', payload: { url: GOOD_URL } });
    expect(res.statusCode).toBe(402);
    const challenge = res.json() as { accepts: Array<{ amount: string }>; resource: { url: string } };
    expect(challenge.accepts[0]?.amount).toBe('2000');
    expect(challenge.resource.url).toContain('/v1/x402/audit');
    expect(structuredCalls).toHaveLength(0);
  });

  it('A2: a paid single-URL audit returns the audit report and records a ledger row', async () => {
    const { account } = makePayer();
    const res = await paidAudit({ url: GOOD_URL });
    expect(res.status).toBe(200);
    const body = res.data as {
      audit: {
        url: string;
        seo: Record<string, unknown>;
        og: Record<string, unknown>;
        links: Record<string, unknown>;
      };
      payment: { payer: string; priceUsdcUnits: number };
    };
    expect(body.audit.url).toBe(GOOD_URL);
    expect(body.audit.seo).toBeDefined();
    expect(body.audit.og).toBeDefined();
    expect(body.audit.links).toBeDefined();
    expect(body.payment).toMatchObject({ payer: account.address, priceUsdcUnits: 2000 });
    const rows = ledgerRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      endpoint: 'audit',
      payer: account.address,
      revenue_usdc: 2000,
      cost_usdc: 200,
      net_margin_usdc: 1800,
    });
  });

  it('A3: an invalid body (no url) returns 422 unprocessable', async () => {
    let err: unknown;
    try {
      await paidAudit({});
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    const { status, code } = responseOf(err);
    expect(status).toBe(422);
    expect(code).toBe('unprocessable');
  });

  it('A4: capture failure returns 502 audit_failed and records nothing', async () => {
    failingUrls.add(GOOD_URL);
    const before = ledgerRows().length;
    let err: unknown;
    try {
      await paidAudit({ url: GOOD_URL });
    } catch (e) {
      err = e;
    } finally {
      failingUrls.delete(GOOD_URL);
    }
    expect(err).toBeDefined();
    const { status, code } = responseOf(err);
    expect(status).toBe(502);
    expect(code).toBe('audit_failed');
    expect(ledgerRows().length).toBe(before);
  });

  it('A5: local chain: the audit route returns 503 x402_disabled', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'POST', url: '/v1/x402/audit', payload: { url: GOOD_URL } });
      expect(res.statusCode).toBe(503);
      const envelope = res.json() as { error: { code: string } };
      expect(envelope.error.code).toBe('x402_disabled');
    } finally {
      await closeApiFixture(fx);
    }
  });
});
