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
import { closeApiFixture, errorEnvelope, FAKE_PNG, makeApiFixture } from './fixture.js';

const CAPTURE_URL = 'https://example.com/';
const SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const MERCHANT_ADDRESS = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';

interface X402Fixture {
  readonly app: FastifyInstance;
  readonly dir: string;
  readonly db: Db;
}

/** x402-enabled app (same harness as x402-stealth-surface.test.ts). */
function makeX402Fixture(): X402Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'webcap-async-capture-'));
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
    captureStructured: async (): Promise<never> => {
      throw new CaptureError('not used in async capture probe');
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

function challengeAmount(res: { json(): unknown }): string {
  const challenge = res.json() as { accepts: Array<{ amount: string }> };
  const first = challenge.accepts[0];
  expect(first, 'the 402 challenge must carry an accepts entry').toBeDefined();
  return String(first?.amount);
}

describe('C-S1: POST /v1/capture/jobs (async capture enqueue)', () => {
  it('enqueues a job: 202 {jobId, status:"queued"} and charges 1 credit like sync capture', async () => {
    const fx = makeApiFixture();
    try {
      fx.credits.grantCredits(fx.accountId, 2, 'test_seed');
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/capture/jobs',
        payload: { url: CAPTURE_URL },
        headers: { authorization: `Bearer ${fx.apiKey}` },
      });
      expect(res.statusCode).toBe(202);
      const created = res.json() as { jobId: string; status: string };
      expect(created.jobId).toMatch(/^[0-9a-f-]{36}$/);
      expect(created.status).toBe('queued');
      expect(fx.accounts.getBalance(fx.accountId)).toBe(1);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('rejects enqueue without an API key with 401', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'POST', url: '/v1/capture/jobs', payload: { url: CAPTURE_URL } });
      expect(res.statusCode).toBe(401);
      expect(errorEnvelope(res).code).toBe('unauthorized');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('rejects enqueue with 402 insufficient_credits when the balance is 0', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/capture/jobs',
        payload: { url: CAPTURE_URL },
        headers: { authorization: `Bearer ${fx.apiKey}` },
      });
      expect(res.statusCode).toBe(402);
      expect(errorEnvelope(res).code).toBe('insufficient_credits');
      expect(fx.accounts.getBalance(fx.accountId)).toBe(0);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('422 on a missing or invalid url', async () => {
    const fx = makeApiFixture();
    try {
      fx.credits.grantCredits(fx.accountId, 3, 'test_seed');
      const badBodies: Array<Record<string, unknown>> = [{}, { url: 42 }, { url: 'not a url' }, { url: 'http://example.com/' }];
      for (const payload of badBodies) {
        const res = await fx.app.inject({
          method: 'POST',
          url: '/v1/capture/jobs',
          payload,
          headers: { authorization: `Bearer ${fx.apiKey}` },
        });
        expect(res.statusCode, `payload ${JSON.stringify(payload)} must be 422`).toBe(422);
        expect(errorEnvelope(res).code).toBe('unprocessable');
      }
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('carries the same x402 price auth as sync capture: unpaid 402 at 1000 units', async () => {
    const fx = makeX402Fixture();
    try {
      const sync = await fx.app.inject({ method: 'POST', url: '/v1/x402/capture', payload: { url: CAPTURE_URL } });
      expect(sync.statusCode).toBe(402);
      const res = await fx.app.inject({ method: 'POST', url: '/v1/capture/jobs', payload: { url: CAPTURE_URL } });
      expect(res.statusCode).toBe(402);
      expect(challengeAmount(res)).toBe(challengeAmount(sync));
      expect(challengeAmount(res)).toBe('1000');
    } finally {
      await closeX402Fixture(fx);
    }
  });
});

describe('C-S1: GET /v1/capture/jobs/:id (job status)', () => {
  it('404 not_found for an unknown job id', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/v1/capture/jobs/does-not-exist' });
      expect(res.statusCode).toBe(404);
      expect(errorEnvelope(res).code).toBe('not_found');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('reaches a terminal state via the AppDeps-injected runner (no timers): completed carries result.artifactUrl', async () => {
    const fx = makeApiFixture();
    try {
      fx.credits.grantCredits(fx.accountId, 1, 'test_seed');
      const post = await fx.app.inject({
        method: 'POST',
        url: '/v1/capture/jobs',
        payload: { url: CAPTURE_URL },
        headers: { authorization: `Bearer ${fx.apiKey}` },
      });
      expect(post.statusCode).toBe(202);
      const created = post.json() as { jobId: string; status: string };

      // No timers: poll the status route until the injected runner finishes.
      let seen: { status: string; result?: { artifactUrl?: unknown }; payment?: unknown } | undefined;
      for (let attempt = 0; attempt < 25; attempt += 1) {
        const got = await fx.app.inject({ method: 'GET', url: `/v1/capture/jobs/${created.jobId}` });
        expect(got.statusCode).toBe(200);
        const state = got.json() as { status: string; result?: { artifactUrl?: unknown }; payment?: unknown };
        expect(['queued', 'processing', 'completed', 'failed']).toContain(state.status);
        seen = state;
        if (state.status === 'completed' || state.status === 'failed') break;
      }
      expect(seen, 'the job must reach completed|failed without timers').toBeDefined();
      expect(['completed', 'failed']).toContain(seen?.status);
      if (seen?.status === 'completed') {
        const artifactUrl = seen.result?.artifactUrl;
        expect(typeof artifactUrl).toBe('string');
        const prefix = `${fx.config.publicBaseUrl}/v1/artifacts/`;
        expect(String(artifactUrl).startsWith(prefix)).toBe(true);
        const path = String(artifactUrl).slice(fx.config.publicBaseUrl.length);
        const artifact = await fx.app.inject({ method: 'GET', url: path });
        expect(artifact.statusCode).toBe(200);
        expect(Buffer.from(artifact.rawPayload)).toEqual(FAKE_PNG);
      }
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('a terminal paid job carries the x402-style payment receipt (optional-only additions)', async () => {
    const fx = makeApiFixture();
    try {
      fx.credits.grantCredits(fx.accountId, 1, 'test_seed');
      const post = await fx.app.inject({
        method: 'POST',
        url: '/v1/capture/jobs',
        payload: { url: CAPTURE_URL },
        headers: { authorization: `Bearer ${fx.apiKey}` },
      });
      expect(post.statusCode).toBe(202);
      const created = post.json() as { jobId: string };

      let payment: { payer?: unknown; priceUsdcUnits?: unknown; creditsUsed?: unknown; costUsdcUnits?: unknown } | undefined;
      let terminal = false;
      for (let attempt = 0; attempt < 25; attempt += 1) {
        const got = await fx.app.inject({ method: 'GET', url: `/v1/capture/jobs/${created.jobId}` });
        expect(got.statusCode).toBe(200);
        const state = got.json() as {
          status: string;
          payment?: { payer?: unknown; priceUsdcUnits?: unknown; creditsUsed?: unknown; costUsdcUnits?: unknown };
        };
        if (state.status === 'completed' || state.status === 'failed') {
          terminal = true;
          payment = state.payment;
          break;
        }
      }
      expect(terminal, 'the job must reach a terminal state').toBe(true);
      expect(payment, 'a terminal paid job must carry a payment receipt').toBeDefined();
      expect(typeof payment?.priceUsdcUnits).toBe('number');
      // Optional-only additions: present only as numbers, never breaking the base shape.
      if (payment?.creditsUsed !== undefined) expect(typeof payment.creditsUsed).toBe('number');
      if (payment?.costUsdcUnits !== undefined) expect(typeof payment.costUsdcUnits).toBe('number');
    } finally {
      await closeApiFixture(fx);
    }
  });
});
