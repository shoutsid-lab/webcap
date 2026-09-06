import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { openDb, type Db } from '../../src/db/index.js';
import { makeArtifactRepo } from '../../src/db/artifacts.js';
import type { WebcapConfig } from '../../src/config.js';
import { buildApp } from '../../src/server/server.js';
import { CaptureError } from '../../src/capture/errors.js';
import type { CaptureRequest, CaptureResult } from '../../src/capture/pipeline.js';
import type { OgResult } from '../../src/capture/og.js';
import { makeMockFacilitator } from '../helpers/facilitator.js';
import {
  closeApiFixture,
  errorEnvelope,
  FAKE_PNG,
  makeApiFixture,
  MERCHANT_ADDRESS,
} from './fixture.js';

const SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

interface X402Fixture {
  readonly app: FastifyInstance;
  readonly dir: string;
  readonly db: Db;
}

function makeX402Fixture(): X402Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'webcap-stealth-surface-'));
  const db = openDb(join(dir, 'x402.db'));
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
    dbPath: join(dir, 'x402.db'),
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
  const capture = async (req: CaptureRequest): Promise<CaptureResult> => ({
    buffer: FAKE_PNG,
    format: req.format ?? 'png',
    bytes: FAKE_PNG.length,
  });
  const app = buildApp({
    db,
    config,
    capture,
    captureStructured: async () => {
      throw new CaptureError('not used in stealth surface probe');
    },
    og: async (req: { url: string }): Promise<OgResult> => ({ url: req.url, title: 'Stub Title' }),
    artifacts: makeArtifactRepo(db),
    x402Facilitator: makeMockFacilitator('eip155:84532').facilitator,
  });
  return { app, dir, db };
}

async function closeX402Fixture(fx: X402Fixture): Promise<void> {
  await fx.app.close();
  fx.db.close();
  rmSync(fx.dir, { recursive: true, force: true });
}

interface Challenge402 {
  readonly accepts: ReadonlyArray<{ readonly amount: string }>;
  readonly extensions?: { readonly bazaar?: unknown };
}

interface BazaarBodyView {
  readonly properties?: Record<string, { readonly properties?: Record<string, unknown> } & Record<string, unknown>>;
}

/** Navigate a 402 challenge's bazaar input-body schema to the named object's sub-properties. */
function challengeObjectProps(challenge: Challenge402, objectKey: string): Record<string, unknown> {
  const bazaar = challenge.extensions?.bazaar as
    | { readonly schema?: { readonly properties?: { readonly input?: { readonly properties?: { readonly body?: BazaarBodyView } } } } }
    | undefined;
  const body = bazaar?.schema?.properties?.input?.properties?.body;
  expect(body, 'the 402 challenge must carry a bazaar input-body schema').toBeDefined();
  const props = body?.properties;
  expect(props, 'the 402 challenge body schema must carry properties').toBeDefined();
  const entry = props?.[objectKey];
  expect(entry, `the 402 challenge body schema must describe ${objectKey}`).toBeDefined();
  const sub = entry?.properties;
  expect(sub, `the 402 challenge body schema must describe ${objectKey} sub-properties`).toBeDefined();
  return sub ?? {};
}

const STEALTH_OPTIONS = {
  proxy: 'stealth',
  waitFor: { selector: '#main', timeoutMs: 2000 },
  actions: [
    { type: 'click', selector: '#consent' },
    { type: 'type', selector: '#q', text: 'hello' },
    { type: 'wait', timeoutMs: 500 },
  ],
} as const;

describe('T2-S1: stealth 402 surface (capture)', () => {
  it('unpaid capture with stealth options still 402s at 1000 units with proxy/waitFor/actions in the challenge schema', async () => {
    const fx = makeX402Fixture();
    try {
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/x402/capture',
        payload: { url: 'https://example.com/', options: STEALTH_OPTIONS },
      });
      expect(res.statusCode).toBe(402);
      const challenge = res.json() as Challenge402;
      expect(String(challenge.accepts[0]?.amount)).toBe('1000');
      const options = challengeObjectProps(challenge, 'options');
      for (const key of ['proxy', 'waitFor', 'actions']) {
        expect(options, `capture 402 challenge options must list ${key}`).toHaveProperty(key);
      }
      expect(options['proxy']).toMatchObject({ type: 'string' });
      expect(options['waitFor']).toMatchObject({ type: 'object' });
      expect(options['actions']).toMatchObject({ type: 'array', maxItems: 5 });
    } finally {
      await closeX402Fixture(fx);
    }
  });
});

describe('T2-S2: stealth 402 surface (extract)', () => {
  it('unpaid extract with stealth options still 402s at 10000 units with options proxy/waitFor/actions in the challenge schema', async () => {
    const fx = makeX402Fixture();
    try {
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/x402/extract',
        payload: { url: 'https://example.com/', options: STEALTH_OPTIONS },
      });
      expect(res.statusCode).toBe(402);
      const challenge = res.json() as Challenge402;
      expect(String(challenge.accepts[0]?.amount)).toBe('10000');
      const options = challengeObjectProps(challenge, 'options');
      for (const key of ['proxy', 'waitFor', 'actions']) {
        expect(options, `extract 402 challenge options must list ${key}`).toHaveProperty(key);
      }
      expect(options['proxy']).toMatchObject({ type: 'string' });
      expect(options['waitFor']).toMatchObject({ type: 'object' });
      expect(options['actions']).toMatchObject({ type: 'array', maxItems: 5 });
    } finally {
      await closeX402Fixture(fx);
    }
  });
});

describe('T2-S1/S2: stealth validation + price identity', () => {
  it('an unknown stealth action type is 422 on the credits rail while the 402 challenge is unaffected', async () => {
    const fx = makeApiFixture();
    try {
      fx.credits.grantCredits(fx.accountId, 1, 'test_seed');
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/capture',
        payload: {
          url: 'https://example.com/',
          options: { actions: [{ type: 'hover', selector: '#x' }] },
        },
        headers: { authorization: `Bearer ${fx.apiKey}` },
      });
      expect(res.statusCode).toBe(422);
      expect(errorEnvelope(res).code).toBe('unprocessable');
      expect(fx.accounts.getBalance(fx.accountId)).toBe(1);
    } finally {
      await closeApiFixture(fx);
    }
    const xfx = makeX402Fixture();
    try {
      const res = await xfx.app.inject({
        method: 'POST',
        url: '/v1/x402/capture',
        payload: { url: 'https://example.com/' },
      });
      expect(res.statusCode).toBe(402);
      const challenge = res.json() as Challenge402;
      expect(String(challenge.accepts[0]?.amount)).toBe('1000');
    } finally {
      await closeX402Fixture(xfx);
    }
  });

  it('amount identity: capture 1000 / extract 10000 / audit 2000 atomic units', async () => {
    const fx = makeX402Fixture();
    try {
      const cases = [
        { url: '/v1/x402/capture', expected: '1000' },
        { url: '/v1/x402/extract', expected: '10000' },
        { url: '/v1/x402/audit', expected: '2000' },
      ] as const;
      for (const { url, expected } of cases) {
        const res = await fx.app.inject({ method: 'POST', url, payload: { url: 'https://example.com/' } });
        expect(res.statusCode).toBe(402);
        const challenge = res.json() as Challenge402;
        expect(String(challenge.accepts[0]?.amount), `POST ${url} 402 amount`).toBe(expected);
      }
    } finally {
      await closeX402Fixture(fx);
    }
  });
});

describe('T2-S1/S2: OpenAPI + service descriptor surface', () => {
  it('openapi capture options lists proxy/waitFor/actions and the extract body carries stealth options', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/openapi.json' });
      expect(res.statusCode).toBe(200);
      const doc = res.json() as {
        readonly paths: Record<string, Record<string, { readonly requestBody?: { readonly content?: Record<string, { readonly schema?: unknown }> } } | undefined>>;
      };
      const captureSchema = doc.paths['/v1/x402/capture']?.post?.requestBody?.content?.['application/json']?.schema as
        | { readonly properties?: { readonly options?: { readonly properties?: Record<string, unknown> } } }
        | undefined;
      const captureOptions = captureSchema?.properties?.options?.properties ?? {};
      for (const key of ['proxy', 'waitFor', 'actions']) {
        expect(captureOptions, `openapi capture options must document ${key}`).toHaveProperty(key);
      }
      const extractSchema = doc.paths['/v1/x402/extract']?.post?.requestBody?.content?.['application/json']?.schema as
        | { readonly properties?: { readonly options?: { readonly properties?: Record<string, unknown> } } }
        | undefined;
      const extractOptions = extractSchema?.properties?.options?.properties ?? {};
      for (const key of ['proxy', 'waitFor', 'actions']) {
        expect(extractOptions, `openapi extract options must document ${key}`).toHaveProperty(key);
      }
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('the /v1/x402/service descriptor bodies mention the stealth options', async () => {
    const fx = makeX402Fixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/v1/x402/service' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { readonly paidEndpoints: ReadonlyArray<{ readonly path: string; readonly body: unknown }> };
      for (const path of ['/v1/x402/capture', '/v1/x402/extract']) {
        const entry = body.paidEndpoints.find((e) => e.path === path);
        expect(entry, `${path} must be listed in paidEndpoints`).toBeDefined();
        const text = JSON.stringify(entry?.body ?? {});
        for (const key of ['proxy', 'waitFor', 'actions']) {
          expect(text, `${path} descriptor body must mention ${key}`).toContain(key);
        }
      }
    } finally {
      await closeX402Fixture(fx);
    }
  });
});
