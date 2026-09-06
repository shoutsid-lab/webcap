import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { openDb, type Db } from '../../src/db/index.js';
import { makeArtifactRepo } from '../../src/db/artifacts.js';
import type { WebcapConfig } from '../../src/config.js';
import { buildApp } from '../../src/server/server.js';
import { makeMockFacilitator, type MockFacilitator } from '../helpers/facilitator.js';
import { privateKeyToAccount } from 'viem/accounts';
import { ExactEvmScheme } from '@x402/evm';
import { x402Client, wrapAxiosWithPayment } from '@x402/axios';

const SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const MERCHANT_ADDRESS = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';
const PAYER_KEY_A = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b786900';
const SEED_URL = 'https://example.com/';
const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://example.com/</loc></url>
<url><loc>https://example.com/about</loc></url>
<url><loc>https://example.com/contact</loc></url>
</urlset>`;

let dir: string;
let db: Db;
let app: FastifyInstance;
let baseUrl: string;
let mock: MockFacilitator;

function makePayer() {
  const account = privateKeyToAccount(PAYER_KEY_A);
  return { account, client: new x402Client().register('eip155:*', new ExactEvmScheme(account)) };
}

async function paidMapLite(payload: unknown) {
  const { client } = makePayer();
  const api = wrapAxiosWithPayment(axios.create({ baseURL: baseUrl }), client);
  return api.post('/v1/x402/map-lite', payload);
}

function responseOf(err: unknown): { status?: number; code?: string } {
  const response = (err as { response?: { status?: number; data?: { error?: { code?: string } } } }).response;
  return { status: response?.status, code: response?.data?.error?.code };
}

function ledgerRows(): Array<{ endpoint: string; revenue_usdc: number; cost_usdc: number; payer: string }> {
  return db
    .prepare<[], { endpoint: string; revenue_usdc: number; cost_usdc: number; payer: string }>(
      'SELECT endpoint, revenue_usdc, cost_usdc, payer FROM revenue_ledger',
    )
    .all();
}

/** Stub the discovery fetch plane: map from request URL to body (string), status, or 'boom'. */
function stubDiscovery(routes: Record<string, string | { status: number } | 'boom'>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (raw: string) => {
      const route = routes[raw];
      if (route === 'boom') throw new Error(`fetch failed for ${raw}: boom`);
      if (route === undefined) return new Response('not found', { status: 404 });
      if (typeof route === 'string') return new Response(route, { status: 200 });
      return new Response('not found', { status: route.status });
    }),
  );
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'webcap-x402-maplite-'));
  db = openDb(join(dir, 'x402-maplite.db'));
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
    dbPath: join(dir, 'x402-maplite.db'),
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
      throw new Error('capture is not used in map-lite tests');
    },
    captureStructured: async () => {
      throw new Error('captureStructured is not used in map-lite tests');
    },
    og: async ({ url }) => ({ url, title: 'Stub' }),
    x402Facilitator: mock.facilitator,
    artifacts: makeArtifactRepo(db),
  });
  baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('x402 map-lite (v2 wire, mock facilitator, stubbed discovery fetch)', () => {
  it('M0: an unpaid map-lite returns 402 at the audit-tier price (2000), not capture/extract', async () => {
    stubDiscovery({});
    const res = await app.inject({ method: 'POST', url: '/v1/x402/map-lite', payload: { url: SEED_URL } });
    expect(res.statusCode).toBe(402);
    const challenge = res.json() as { accepts: Array<{ amount: string }>; resource: { url: string } };
    expect(challenge.accepts[0]?.amount).toBe('2000');
    expect(challenge.resource.url).toContain('/v1/x402/map-lite');
  });

  it('T3-S1: a paid map-lite over sitemap.xml returns the URL list + a 2000-unit receipt', async () => {
    stubDiscovery({
      'https://example.com/robots.txt': 'User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n',
      'https://example.com/sitemap.xml': SITEMAP_XML,
    });
    const { account } = makePayer();
    const before = ledgerRows().length;
    const res = await paidMapLite({ url: SEED_URL });
    expect(res.status).toBe(200);
    const body = res.data as { urls: string[]; payment: { payer: string; priceUsdcUnits: number } };
    expect(body.urls).toEqual(['https://example.com/', 'https://example.com/about', 'https://example.com/contact']);
    expect(body.payment).toMatchObject({ payer: account.address, priceUsdcUnits: 2000 });
    const rows = ledgerRows();
    expect(rows).toHaveLength(before + 1);
    expect(rows[rows.length - 1]).toMatchObject({ endpoint: 'map-lite', payer: account.address, revenue_usdc: 2000 });
  });

  it('T3-S1b: maxUrls caps the returned list (sitemap has 3, maxUrls 2 -> 2)', async () => {
    stubDiscovery({ 'https://example.com/sitemap.xml': SITEMAP_XML });
    const res = await paidMapLite({ url: SEED_URL, maxUrls: 2 });
    expect(res.status).toBe(200);
    expect((res.data as { urls: string[] }).urls).toEqual([
      'https://example.com/',
      'https://example.com/about',
    ]);
  });

  it('T3-S2a: no sitemap + a link-free page returns 200 with an empty list, NOT 502', async () => {
    stubDiscovery({
      'https://example.com/robots.txt': 'User-agent: *\nAllow: /\n',
      'https://example.com/sitemap.xml': { status: 404 },
      [SEED_URL]: '<html><head><title>lonely</title></head><body><p>no links here</p></body></html>',
    });
    const before = ledgerRows().length;
    const res = await paidMapLite({ url: SEED_URL });
    expect(res.status).toBe(200);
    expect((res.data as { urls: string[] }).urls).toEqual([]);
    expect(ledgerRows()).toHaveLength(before + 1);
  });

  it('T3-S2b: the 1-hop crawl excludes cross-host links', async () => {
    stubDiscovery({
      'https://example.com/sitemap.xml': { status: 404 },
      [SEED_URL]:
        '<html><body><a href="/local">Local</a><a href="https://other.com/evil">evil</a>' +
        '<a href="https://sub.example.com/x">sub</a></body></html>',
    });
    const res = await paidMapLite({ url: SEED_URL });
    expect(res.status).toBe(200);
    expect((res.data as { urls: string[] }).urls).toEqual(['https://example.com/local']);
  });

  it('T3-S2c: maxUrls above 50 returns 422 unprocessable', async () => {
    stubDiscovery({});
    let err: unknown;
    try {
      await paidMapLite({ url: SEED_URL, maxUrls: 51 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    const { status, code } = responseOf(err);
    expect(status).toBe(422);
    expect(code).toBe('unprocessable');
  });

  it('T3-S2d: seed-page fetch failure with no sitemap returns 502 map_failed and records nothing', async () => {
    stubDiscovery({
      'https://example.com/robots.txt': { status: 404 },
      'https://example.com/sitemap.xml': { status: 404 },
      [SEED_URL]: 'boom',
    });
    const before = ledgerRows().length;
    let err: unknown;
    try {
      await paidMapLite({ url: SEED_URL });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    const { status, code } = responseOf(err);
    expect(status).toBe(502);
    expect(code).toBe('map_failed');
    expect(ledgerRows()).toHaveLength(before);
  });
});
