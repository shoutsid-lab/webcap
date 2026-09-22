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
import type { CaptureRequest, PageStructure, StructuredCapture } from '../../src/capture/pipeline.js';
import { makeMockFacilitator, type MockFacilitator } from '../helpers/facilitator.js';
import { privateKeyToAccount } from 'viem/accounts';
import { ExactEvmScheme } from '@x402/evm';
import { x402Client, wrapAxiosWithPayment } from '@x402/axios';

const SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const MERCHANT_ADDRESS = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';
const PAYER_KEY_A = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b786900';
const GOOD_URL = 'https://example.com/';
const BLOG_URL = 'https://example.com/blog/hello';

let dir: string;
let db: Db;
let app: FastifyInstance;
let baseUrl: string;
let mock: MockFacilitator;
const structuredCalls: string[] = [];

function structureFor(url: string): PageStructure {
  return {
    title: `Title of ${url}`,
    description: `Description of ${url}`,
    headings: [{ level: 1, text: `Heading from ${url}` }],
    paragraphs: [`Body text for ${url}. Contact hello@example.com.`],
    links: [{ href: url, text: 'self' }],
    images: [],
    wordCount: 12,
    markdown: `# Heading from ${url}\n\nBody text for ${url}.`,
  };
}

const fakeCaptureStructured = async (req: CaptureRequest): Promise<StructuredCapture> => {
  structuredCalls.push(req.url);
  return { html: `<html><head><meta property="og:type" content="article"></head><body></body></html>`, structure: structureFor(req.url) };
};

function makePayer() {
  const account = privateKeyToAccount(PAYER_KEY_A);
  return { account, client: new x402Client().register('eip155:*', new ExactEvmScheme(account)) };
}

async function paidPost(path: string, payload: unknown) {
  const { client } = makePayer();
  const api = wrapAxiosWithPayment(axios.create({ baseURL: baseUrl }), client);
  return api.post(path, payload);
}

function ledgerRows(): Array<{ endpoint: string; revenue_usdc: number; cost_usdc: number; payer: string }> {
  return db
    .prepare<[], { endpoint: string; revenue_usdc: number; cost_usdc: number; payer: string }>(
      'SELECT endpoint, revenue_usdc, cost_usdc, payer FROM revenue_ledger',
    )
    .all();
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'webcap-x402-analyze-'));
  db = openDb(join(dir, 'x402-analyze.db'));
  mock = makeMockFacilitator('eip155:84532');
  const config: WebcapConfig = {
    chain: { name: 'base-sepolia', rpcUrl: 'https://sepolia.base.org', chainId: 84532, usdcContract: SEPOLIA_USDC, explorer: 'https://sepolia.basescan.org' },
    chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
    usdcAddress: SEPOLIA_USDC,
    merchantAddress: MERCHANT_ADDRESS,
    port: 0,
    pollIntervalMs: 5_000,
    merchantPrivateKey: '',
    dbPath: join(dir, 'x402-analyze.db'),
    x402Network: 'eip155:84532',
    x402Asset: SEPOLIA_USDC,
    x402PayTo: MERCHANT_ADDRESS,
    x402PriceUsdcUnits: 1_000,
    x402ExtractPriceUsdcUnits: 10_000,
    x402AuditPriceUsdcUnits: 2_000,
    x402VideoPriceUsdcUnits: 5_000,
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
      throw new Error('capture is not used in analyze tests');
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

describe('x402 analyze (v2 wire, mock facilitator, no chain, no model)', () => {
  it('A1: unpaid analyze returns 402 at the extract tier without touching capture', async () => {
    const before = structuredCalls.length;
    const res = await app.inject({ method: 'POST', url: '/v1/x402/analyze', payload: { url: GOOD_URL, task: 'classification' } });
    expect(res.statusCode).toBe(402);
    const challenge = res.json() as { accepts: Array<{ amount: string }>; resource: { url: string } };
    expect(challenge.accepts[0]?.amount).toBe('10000');
    expect(challenge.resource.url).toContain('/v1/x402/analyze');
    expect(structuredCalls).toHaveLength(before);
  });

  it('A2: unpaid analyze/batch returns 402 at the extract tier', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/x402/analyze/batch', payload: { urls: [GOOD_URL], task: 'entities' } });
    expect(res.statusCode).toBe(402);
    const challenge = res.json() as { accepts: Array<{ amount: string }> };
    expect(challenge.accepts[0]?.amount).toBe('10000');
  });

  it('A3: paid analyze classifies via the deterministic fallback and records a ledger row', async () => {
    const { account } = makePayer();
    const res = await paidPost('/v1/x402/analyze', { url: BLOG_URL, task: 'classification' });
    expect(res.status).toBe(200);
    const body = res.data as { task: string; result: { category: string; confidence: number; mode: string }; payment: { payer: string; priceUsdcUnits: number } };
    expect(body.task).toBe('classification');
    expect(typeof body.result.category).toBe('string');
    expect(body.result.mode).toBe('deterministic');
    expect(body.payment).toMatchObject({ payer: account.address, priceUsdcUnits: 10_000 });
    const rows = ledgerRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ endpoint: 'analyze', payer: account.address, revenue_usdc: 10_000, cost_usdc: 200 });
  });

  it('A4: paid analyze with task=diff is 422 with watches guidance and records nothing', async () => {
    const before = ledgerRows().length;
    let err: unknown;
    try {
      await paidPost('/v1/x402/analyze', { url: GOOD_URL, task: 'diff' });
    } catch (e) {
      err = e;
    }
    const response = (err as { response?: { status?: number; data?: { error?: { code?: string; message?: string } } } }).response;
    expect(response?.status).toBe(422);
    expect(response?.data?.error?.code).toBe('unprocessable');
    expect(String(response?.data?.error?.message)).toContain('/v1/watches');
    expect(ledgerRows()).toHaveLength(before);
  });

  it('A5: paid analyze with an unknown task is 422 (not 500) and records nothing', async () => {
    const before = ledgerRows().length;
    let err: unknown;
    try {
      await paidPost('/v1/x402/analyze', { url: GOOD_URL, task: 'nope' });
    } catch (e) {
      err = e;
    }
    const response = (err as { response?: { status?: number; data?: { error?: { code?: string } } } }).response;
    expect(response?.status).toBe(422);
    expect(response?.data?.error?.code).toBe('unprocessable');
    expect(ledgerRows()).toHaveLength(before);
  });

  it('A6: paid extract now carries classification (type + confidence) per URL', async () => {
    const res = await paidPost('/v1/x402/extract', { url: GOOD_URL });
    expect(res.status).toBe(200);
    const body = res.data as { results: Array<{ status: string; data: { classification: { category: string; confidence: number } } }> };
    expect(body.results[0]?.status).toBe('ok');
    expect(typeof body.results[0]?.data.classification.category).toBe('string');
    expect(typeof body.results[0]?.data.classification.confidence).toBe('number');
  });

  it('A7: paid batch analyze returns per-URL deterministic results for one payment', async () => {
    const before = ledgerRows().length;
    const res = await paidPost('/v1/x402/analyze/batch', { urls: [GOOD_URL, BLOG_URL], task: 'entities' });
    expect(res.status).toBe(200);
    const body = res.data as { results: Array<{ url: string; status: string; result: { entities: unknown[] } }>; task: string };
    expect(body.task).toBe('entities');
    expect(body.results.map((r) => r.url)).toEqual([GOOD_URL, BLOG_URL]);
    expect(body.results.every((r) => r.status === 'ok')).toBe(true);
    const rows = ledgerRows();
    expect(rows).toHaveLength(before + 1);
    expect(rows[rows.length - 1]).toMatchObject({ endpoint: 'analyze', revenue_usdc: 10_000, cost_usdc: 400 });
  });
});
