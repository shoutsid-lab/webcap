import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import axios from 'axios';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { openDb, type Db } from '../../src/db/index.js';
import { makeAccountsRepo } from '../../src/db/accounts.js';
import { makeApiKeysRepo } from '../../src/db/api_keys.js';
import { makeArtifactRepo } from '../../src/db/artifacts.js';
import { generateApiKey, hashKey } from '../../src/util/keys.js';
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
const BAD_URL = 'https://example.org/';

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
  return { html: `<html><title>${req.url}</title></html>`, structure: structureFor(req.url) };
};

function makePayer() {
  const account = privateKeyToAccount(PAYER_KEY_A);
  return { account, client: new x402Client().register('eip155:*', new ExactEvmScheme(account)) };
}

async function paidExtract(payload: unknown) {
  const { client } = makePayer();
  const api = wrapAxiosWithPayment(axios.create({ baseURL: baseUrl }), client);
  return api.post('/v1/x402/extract', payload);
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
  dir = mkdtempSync(join(tmpdir(), 'webcap-x402-extract-'));
  db = openDb(join(dir, 'x402-extract.db'));
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
    dbPath: join(dir, 'x402-extract.db'),
    x402Network: 'eip155:84532',
    x402Asset: SEPOLIA_USDC,
    x402PayTo: MERCHANT_ADDRESS,
    x402PriceUsdcUnits: 1_000,
    x402ExtractPriceUsdcUnits: 10_000,
    x402AuditPriceUsdcUnits: 2_000,
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
      throw new Error('capture is not used in extract tests');
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

describe('x402 extract (v2 wire, mock facilitator, no chain)', () => {
  it('E1: an unpaid extract returns 402 at the extract price, not the capture price', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/x402/extract', payload: { url: GOOD_URL } });
    expect(res.statusCode).toBe(402);
    const challenge = res.json() as { accepts: Array<{ amount: string }>; resource: { url: string } };
    expect(challenge.accepts[0]?.amount).toBe('10000');
    expect(challenge.resource.url).toContain('/v1/x402/extract');
    expect(structuredCalls).toHaveLength(0);
  });

  it('E2: a paid single-URL extract returns the deterministic structure and records a ledger row', async () => {
    const { account } = makePayer();
    const res = await paidExtract({ url: GOOD_URL });
    expect(res.status).toBe(200);
    const body = res.data as {
      results: Array<{ url: string; status: string; data: { title: string; markdown: string } }>;
      payment: { payer: string; priceUsdcUnits: number };
    };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ url: GOOD_URL, status: 'ok' });
    expect(body.results[0]?.data.title).toBe(`Title of ${GOOD_URL}`);
    expect(body.results[0]?.data.markdown).toBe(`# Heading from ${GOOD_URL}\n\nBody text for ${GOOD_URL}.`);
    expect(body.payment).toMatchObject({ payer: account.address, priceUsdcUnits: 10_000 });
    const rows = ledgerRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      endpoint: 'extract',
      payer: account.address,
      revenue_usdc: 10_000,
      cost_usdc: 200,
      net_margin_usdc: 9_800,
    });
  });

  it('E3: a paid batch of 2 URLs returns both and records cost = 2x compute for one payment', async () => {
    const before = ledgerRows().length;
    const res = await paidExtract({ urls: [GOOD_URL, BAD_URL] });
    expect(res.status).toBe(200);
    const body = res.data as { results: Array<{ url: string; status: string }> };
    expect(body.results.map((r) => r.url)).toEqual([GOOD_URL, BAD_URL]);
    expect(body.results.every((r) => r.status === 'ok')).toBe(true);
    const rows = ledgerRows();
    expect(rows).toHaveLength(before + 1);
    expect(rows[rows.length - 1]).toMatchObject({ endpoint: 'extract', revenue_usdc: 10_000, cost_usdc: 400, net_margin_usdc: 9_600 });
  });

  it('E4: a partial failure returns 200 with the failed url marked as an error', async () => {
    failingUrls.add(BAD_URL);
    try {
      const res = await paidExtract({ urls: [GOOD_URL, BAD_URL] });
      expect(res.status).toBe(200);
      const body = res.data as { results: Array<{ url: string; status: string; error?: string }> };
      expect(body.results.find((r) => r.url === GOOD_URL)?.status).toBe('ok');
      const bad = body.results.find((r) => r.url === BAD_URL);
      expect(bad?.status).toBe('error');
      expect(bad?.error).toBeDefined();
    } finally {
      failingUrls.delete(BAD_URL);
    }
  });

  it('E5: all URLs failing returns 502 extract_failed and records nothing', async () => {
    failingUrls.add(GOOD_URL);
    failingUrls.add(BAD_URL);
    const before = ledgerRows().length;
    let err: unknown;
    try {
      await paidExtract({ urls: [GOOD_URL, BAD_URL] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    const { status, code } = responseOf(err);
    expect(status).toBe(502);
    expect(code).toBe('extract_failed');
    expect(ledgerRows().length).toBe(before);
  });

  it('E6: the ledger is merchant-only (403 for a non-merchant, 200 + summary for the merchant)', async () => {
    failingUrls.clear();
    const other = await app.inject({ method: 'POST', url: '/v1/register', payload: { address: '0x2f4d02e1661807158b63455d5752a362e08db32b' } });
    const otherKey = (other.json() as { apiKey: string }).apiKey;
    const forbidden = await app.inject({ method: 'GET', url: '/v1/ledger', headers: { authorization: `Bearer ${otherKey}` } });
    expect(forbidden.statusCode).toBe(403);
    // Live chains block merchant self-registration (abuse guard) — seed the
    // merchant account + key directly, as the ops runbook does.
    const accounts = makeAccountsRepo(db);
    const merchantId = accounts.findByAddress(MERCHANT_ADDRESS) ?? accounts.create(MERCHANT_ADDRESS);
    const merchantKey = generateApiKey();
    makeApiKeysRepo(db).create(merchantId, hashKey(merchantKey));
    const ok = await app.inject({ method: 'GET', url: '/v1/ledger', headers: { authorization: `Bearer ${merchantKey}` } });
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as {
      summary: { requestCount: number; totalRevenueUsdcUnits: number; coveringCompute: boolean };
      recent: unknown[];
    };
    expect(body.summary.requestCount).toBeGreaterThanOrEqual(3);
    expect(body.summary.totalRevenueUsdcUnits).toBeGreaterThanOrEqual(30_000);
    expect(body.summary.coveringCompute).toBe(true);
    expect(Array.isArray(body.recent)).toBe(true);
  });

  it('E7: an invalid body (no url/urls) returns 422 unprocessable', async () => {
    let err: unknown;
    try {
      await paidExtract({});
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    const { status, code } = responseOf(err);
    expect(status).toBe(422);
    expect(code).toBe('unprocessable');
  });

  it('T3-S3a: a paid batch of 11 URLs is accepted (the old 10-cap is gone)', async () => {
    const urls = Array.from({ length: 11 }, (_, i) => `https://example.com/t3-${i}`);
    const res = await paidExtract({ urls });
    expect(res.status).toBe(200);
    const body = res.data as { results: Array<{ url: string; status: string }> };
    expect(body.results).toHaveLength(11);
    expect(body.results.every((r) => r.status === 'ok')).toBe(true);
  });

  it('T3-S3b: a paid batch of 51 URLs returns 422 unprocessable', async () => {
    const urls = Array.from({ length: 51 }, (_, i) => `https://example.com/t3-${i}`);
    let err: unknown;
    try {
      await paidExtract({ urls });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    const { status, code } = responseOf(err);
    expect(status).toBe(422);
    expect(code).toBe('unprocessable');
  });

  it('T3-S3c: the extract price is flat 10000 at batch 1 AND at batch 50', async () => {
    const single = await paidExtract({ url: GOOD_URL });
    expect(single.status).toBe(200);
    expect((single.data as { payment: { priceUsdcUnits: number } }).payment.priceUsdcUnits).toBe(10_000);
    const urls = Array.from({ length: 50 }, (_, i) => `https://example.com/t3-full-${i}`);
    const full = await paidExtract({ urls });
    expect(full.status).toBe(200);
    const fullBody = full.data as {
      results: Array<{ url: string; status: string }>;
      payment: { payer: string; priceUsdcUnits: number };
    };
    expect(fullBody.results).toHaveLength(50);
    expect(fullBody.payment.priceUsdcUnits).toBe(10_000);
  });

  it('T3-S3d: the batch-50 margin tradeoff — per-URL floor 200 units equals the compute cost', async () => {
    // MARGIN TRADEOFF (batch 10 -> 50): the extract price stays flat at 10000
    // while cost scales as 200 x N, so a full batch-50 nets exactly zero and the
    // per-URL revenue floor (10000 / 50 = 200 = $0.0002) equals one compute unit.
    // That floor is the loss boundary: any per-URL cost above 200 units loses
    // money on full batches, which is why the cap stops at 50.
    const rows = ledgerRows();
    const fullBatch = rows.find((r) => r.endpoint === 'extract' && r.cost_usdc === 200 * 50);
    expect(fullBatch).toBeDefined();
    expect(fullBatch).toMatchObject({ revenue_usdc: 10_000, cost_usdc: 10_000, net_margin_usdc: 0 });
    expect(10_000 / 50).toBe(200);
  });

  it('T3-S3e: an all-fail batch still returns 502 extract_failed and records nothing', async () => {
    failingUrls.add(GOOD_URL);
    failingUrls.add(BAD_URL);
    const before = ledgerRows().length;
    let err: unknown;
    try {
      await paidExtract({ urls: [GOOD_URL, BAD_URL] });
    } catch (e) {
      err = e;
    } finally {
      failingUrls.delete(GOOD_URL);
      failingUrls.delete(BAD_URL);
    }
    expect(err).toBeDefined();
    const { status, code } = responseOf(err);
    expect(status).toBe(502);
    expect(code).toBe('extract_failed');
    expect(ledgerRows().length).toBe(before);
  });

  it('local chain: the extract route returns 503 x402_disabled', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'POST', url: '/v1/x402/extract', payload: { url: GOOD_URL } });
      expect(res.statusCode).toBe(503);
      const envelope = res.json() as { error: { code: string } };
      expect(envelope.error.code).toBe('x402_disabled');
    } finally {
      await closeApiFixture(fx);
    }
  });
});
