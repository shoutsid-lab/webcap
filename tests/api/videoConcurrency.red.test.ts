import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { openDb, type Db } from '../../src/db/index.js';
import type { WebcapConfig } from '../../src/config.js';
import { registerVideoRoute } from '../../src/server/video.js';
import { MERCHANT_ADDRESS } from './fixture.js';

/**
 * RED suite for video concurrency 429 beyond capture (V-S2b route half).
 *
 * When the capture semaphore is exhausted, POST /v1/x402/video must answer
 * 429 with the video_busy error envelope — DISTINCT from the 502 video_failed
 * envelope a broken page produces — so callers back off instead of blaming
 * the URL. The capture seam throws the (future) VideoBusyError through a
 * namespace cast (V-S1 RED pattern): tsc-clean now, runtime-RED until GREEN.
 */

vi.mock('../../src/capture/video.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/capture/video.js')>();
  const errors = (await import('../../src/capture/errors.js')) as unknown as {
    readonly VideoBusyError?: new (message: string) => Error;
  };
  return {
    ...actual,
    captureVideo: vi.fn(async () => {
      if (errors.VideoBusyError === undefined) throw new Error('RED: VideoBusyError does not exist yet');
      throw new errors.VideoBusyError('video capture busy (2 concurrent captures in use)');
    }),
  };
});

const SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

let dir: string;
let db: Db;
let app: FastifyInstance;

function testConfig(): WebcapConfig {
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
    dbPath: join(dir, 'video-concurrency.db'),
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
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'webcap-video-concurrency-'));
  db = openDb(join(dir, 'video-concurrency.db'));
  app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (typeof (err as { readonly status?: unknown }).status === 'number') {
      const typed = err as { readonly status: number; readonly code: string; readonly message: string; readonly detail?: unknown };
      const body =
        typed.detail === undefined
          ? { error: { code: typed.code, message: typed.message } }
          : { error: { code: typed.code, message: typed.message, detail: typed.detail } };
      void reply.status(typed.status).send(body);
      return;
    }
    void reply.status(500).send({ error: { code: 'internal', message: 'internal server error' } });
  });
  registerVideoRoute(app, { db, config: testConfig() });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('video V-S2b concurrency 429 beyond capture (RED)', () => {
  it('answers 429 video_busy when the semaphore is exhausted, not 502 video_failed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/x402/video',
      payload: { url: 'https://example.com/' },
    });
    // RED: VideoBusyError does not exist yet — the mock throws a plain Error
    // and the route falls through to 500.
    expect(res.statusCode).toBe(429);
    const body = res.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe('video_busy');
    expect(res.statusCode).not.toBe(502);
    expect(body.error?.code).not.toBe('video_failed');
  });
});
