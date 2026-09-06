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
  const dir = mkdtempSync(join(tmpdir(), 'webcap-stealth-x402-'));
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
      throw new CaptureError('not used in stealth 402 regression');
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

describe('T1-S1: stealth capture happy path passes options through', () => {
  it('returns 200 with the artifact and forwards proxy/waitFor/actions to the capture pipeline', async () => {
    let seen: CaptureRequest | undefined;
    const fx = makeApiFixture({
      capture: async (req: CaptureRequest): Promise<CaptureResult> => {
        seen = req;
        return { buffer: FAKE_PNG, format: req.format ?? 'png', bytes: FAKE_PNG.length };
      },
    });
    try {
      fx.credits.grantCredits(fx.accountId, 1, 'test_seed');
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/capture',
        payload: {
          url: 'https://example.com/',
          options: {
            proxy: 'stealth',
            waitFor: { selector: '#main', timeoutMs: 2000 },
            actions: [
              { type: 'click', selector: '#consent' },
              { type: 'type', selector: '#q', text: 'hello' },
              { type: 'wait', timeoutMs: 500 },
            ],
          },
        },
        headers: { authorization: `Bearer ${fx.apiKey}` },
      });
      expect(res.statusCode).toBe(200);
      const json = res.json() as { artifact: { format: string; bytes: number; data: string } };
      expect(json.artifact.format).toBe('png');
      expect(json.artifact.bytes).toBe(FAKE_PNG.length);
      expect(seen?.options).toEqual({
        proxy: 'stealth',
        waitFor: { selector: '#main', timeoutMs: 2000 },
        actions: [
          { type: 'click', selector: '#consent' },
          { type: 'type', selector: '#q', text: 'hello' },
          { type: 'wait', timeoutMs: 500 },
        ],
      });
    } finally {
      await closeApiFixture(fx);
    }
  });
});

describe('T1-S2: stealth capture edges', () => {
  it('returns 422 for an invalid action shape and leaves the balance untouched', async () => {
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
  });

  it('returns 502 capture_failed when the selector wait times out and refunds the charge', async () => {
    const fx = makeApiFixture({
      capture: async (req: CaptureRequest): Promise<CaptureResult> => {
        if (req.options?.waitFor !== undefined) throw new CaptureError('waitFor selector timed out: #missing');
        return { buffer: FAKE_PNG, format: req.format ?? 'png', bytes: FAKE_PNG.length };
      },
    });
    try {
      fx.credits.grantCredits(fx.accountId, 1, 'test_seed');
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/capture',
        payload: {
          url: 'https://example.com/',
          options: { waitFor: { selector: '#missing', timeoutMs: 1000 } },
        },
        headers: { authorization: `Bearer ${fx.apiKey}` },
      });
      expect(res.statusCode).toBe(502);
      expect(errorEnvelope(res).code).toBe('capture_failed');
      expect(fx.accounts.getBalance(fx.accountId)).toBe(1);
    } finally {
      await closeApiFixture(fx);
    }
  });
});

describe('T1-S3: 402 price regression (no price changes)', () => {
  it('keeps the x402 challenge amounts at capture 1000 / extract 10000 atomic units', async () => {
    const fx = makeX402Fixture();
    try {
      const captureRes = await fx.app.inject({
        method: 'POST',
        url: '/v1/x402/capture',
        payload: { url: 'https://example.com/' },
      });
      expect(captureRes.statusCode).toBe(402);
      const captureChallenge = captureRes.json() as { accepts: Array<{ amount: string }> };
      expect(String(captureChallenge.accepts[0]?.amount)).toBe('1000');

      const extractRes = await fx.app.inject({
        method: 'POST',
        url: '/v1/x402/extract',
        payload: { url: 'https://example.com/' },
      });
      expect(extractRes.statusCode).toBe(402);
      const extractChallenge = extractRes.json() as { accepts: Array<{ amount: string }> };
      expect(String(extractChallenge.accepts[0]?.amount)).toBe('10000');
    } finally {
      await closeX402Fixture(fx);
    }
  });
});
