/**
 * B-S1 (spend caps) + B-S2 (SSRF detail) — RED tests.
 *
 * The spend-cap knobs below (spendCapUsdcUnits / spendCapCredits) do NOT exist
 * on WebcapConfig yet: they stand in for the future WEBCAP_SPEND_CAP_USDC_UNITS
 * / WEBCAP_SPEND_CAP_CREDITS env wiring. They are attached via a cast, so the
 * current server ignores them and the over-cap tests fail (200 instead of a
 * block). GREEN wires the config; the behavior assertions then pass unchanged.
 *
 * B-S2: validatedUrl() currently collapses the guard message to a bare
 * "invalid url" with no detail. These tests pin the target shape instead:
 * 422 unprocessable with detail { reason: <guard message>, dnsRebindingCaveat: true }.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { openDb, type Db } from '../../src/db/index.js';
import { makeAccountsRepo } from '../../src/db/accounts.js';
import { makeApiKeysRepo } from '../../src/db/api_keys.js';
import { makeArtifactRepo } from '../../src/db/artifacts.js';
import { makeCreditsRepo } from '../../src/db/credits.js';
import { makeRevenueRepo } from '../../src/db/revenue.js';
import type { WebcapConfig } from '../../src/config.js';
import { buildApp } from '../../src/server/server.js';
import type { CaptureRequest, CaptureResult } from '../../src/capture/pipeline.js';
import type { OgResult } from '../../src/capture/og.js';
import { CaptureError } from '../../src/capture/errors.js';
import { generateApiKey, hashKey } from '../../src/util/keys.js';
import { x402Client } from '@x402/axios';
import { ExactEvmScheme } from '@x402/evm';
import type { PaymentRequired } from '@x402/core/types';
import { privateKeyToAccount } from 'viem/accounts';
import { makeMockFacilitator } from '../helpers/facilitator.js';
import {
  closeApiFixture,
  CUSTOMER_ADDRESS,
  errorEnvelope,
  FAKE_PNG,
  makeApiFixture,
  MERCHANT_ADDRESS,
} from './fixture.js';

const SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const PAYER_KEY: `0x${string}` = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b786900';

/** Future cap knobs (env WEBCAP_SPEND_CAP_USDC_UNITS / WEBCAP_SPEND_CAP_CREDITS); GREEN wires them. */
interface SpendCapKnobs {
  readonly spendCapUsdcUnits?: number;
  readonly spendCapCredits?: number;
}

function withSpendCap(config: WebcapConfig, knobs: SpendCapKnobs): WebcapConfig {
  return { ...config, ...knobs } as WebcapConfig;
}

interface SpendFixture {
  readonly app: FastifyInstance;
  readonly db: Db;
  readonly dir: string;
  readonly calls: { count: number };
}

async function closeSpendFixture(fx: SpendFixture): Promise<void> {
  await fx.app.close();
  fx.db.close();
  rmSync(fx.dir, { recursive: true, force: true });
}

function stubCapture(calls: { count: number }): (req: CaptureRequest) => Promise<CaptureResult> {
  return async (req: CaptureRequest): Promise<CaptureResult> => {
    calls.count += 1;
    return { buffer: FAKE_PNG, format: req.format ?? 'png', bytes: FAKE_PNG.length };
  };
}

function stubCaptureStructured(): Promise<never> {
  throw new CaptureError('not used in spend-cap probe');
}

function stubOg(req: { url: string }): Promise<OgResult> {
  return Promise.resolve({ url: req.url, title: 'Stub Title' });
}

// ---------------------------------------------------------------------------
// x402 (paid) fixture: base-sepolia chain + mock facilitator so /v1/x402/*
// answers instead of 503ing, with a real EIP-3009 payer for cap accounting.
// ---------------------------------------------------------------------------

interface X402SpendFixture extends SpendFixture {
  readonly payerAddress: string;
}

function makeX402SpendFixture(knobs: SpendCapKnobs = {}): X402SpendFixture {
  const dir = mkdtempSync(join(tmpdir(), 'webcap-spend-cap-'));
  const db = openDb(join(dir, 'spend.db'));
  const base: WebcapConfig = {
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
    dbPath: join(dir, 'spend.db'),
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
  const calls = { count: 0 };
  const app = buildApp({
    db,
    config: withSpendCap(base, knobs),
    capture: stubCapture(calls),
    captureStructured: stubCaptureStructured,
    og: stubOg,
    artifacts: makeArtifactRepo(db),
    x402Facilitator: makeMockFacilitator('eip155:84532').facilitator,
  });
  return { app, db, dir, calls, payerAddress: privateKeyToAccount(PAYER_KEY).address };
}

/** A real gasless (EIP-3009) paid capture over inject, mirroring tests/e2e signing. */
async function paidX402Capture(fx: Pick<X402SpendFixture, 'app'>, url = 'https://example.com/') {
  const account = privateKeyToAccount(PAYER_KEY);
  const client = new x402Client().register('eip155:*', new ExactEvmScheme(account));
  const challengeRes = await fx.app.inject({ method: 'POST', url: '/v1/x402/capture', payload: { url } });
  expect(challengeRes.statusCode).toBe(402);
  const challenge = challengeRes.json() as PaymentRequired;
  const payload = await client.createPaymentPayload(challenge);
  const header = Buffer.from(JSON.stringify(payload)).toString('base64');
  return fx.app.inject({
    method: 'POST',
    url: '/v1/x402/capture',
    payload: { url },
    headers: { 'PAYMENT-SIGNATURE': header },
  });
}

// ---------------------------------------------------------------------------
// credits-rail fixture: local chain + knobbed config (makeApiFixture builds an
// unknobbed config, so this mirrors it with withSpendCap applied).
// ---------------------------------------------------------------------------

interface CreditsSpendFixture extends SpendFixture {
  readonly apiKey: string;
  readonly accountId: number;
}

function makeCreditsSpendFixture(knobs: SpendCapKnobs = {}): CreditsSpendFixture {
  const dir = mkdtempSync(join(tmpdir(), 'webcap-spend-credits-'));
  const db = openDb(join(dir, 'test.db'));
  const base: WebcapConfig = {
    chain: {
      name: 'local',
      rpcUrl: 'http://127.0.0.1:8545',
      chainId: 31337,
      usdcContract: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      explorer: '',
    },
    chainId: 31337,
    rpcUrl: 'http://127.0.0.1:8545',
    usdcAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    merchantAddress: MERCHANT_ADDRESS,
    port: 0,
    pollIntervalMs: 5_000,
    merchantPrivateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b786900',
    dbPath: join(dir, 'test.db'),
    x402Network: undefined,
    x402Asset: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
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
  const accounts = makeAccountsRepo(db);
  const keys = makeApiKeysRepo(db);
  const accountId = accounts.create(CUSTOMER_ADDRESS);
  const apiKey = generateApiKey();
  keys.create(accountId, hashKey(apiKey));
  const calls = { count: 0 };
  const app = buildApp({
    db,
    config: withSpendCap(base, knobs),
    capture: stubCapture(calls),
    captureStructured: stubCaptureStructured,
    og: stubOg,
    artifacts: makeArtifactRepo(db),
  });
  return { app, db, dir, calls, apiKey, accountId };
}

function authHeaders(apiKey: string): Record<string, string> {
  return { authorization: `Bearer ${apiKey}` };
}

// ---------------------------------------------------------------------------
// B-S1: spend caps
// ---------------------------------------------------------------------------

describe('B-S1: x402 spend caps', () => {
  it('payer over cap is blocked (429 or 402 spend_cap_exceeded) with zero capture calls and zero new ledger rows', async () => {
    const fx = makeX402SpendFixture({ spendCapUsdcUnits: 1_500 });
    try {
      const revenue = makeRevenueRepo(fx.db);
      revenue.record({ endpoint: 'capture', payer: fx.payerAddress, revenueUsdcUnits: 1_000, costUsdcUnits: 200 });
      revenue.record({ endpoint: 'capture', payer: fx.payerAddress, revenueUsdcUnits: 1_000, costUsdcUnits: 200 });
      const requestsBefore = makeRevenueRepo(fx.db).summary().requestCount;

      const res = await paidX402Capture(fx);
      expect([402, 429]).toContain(res.statusCode);
      const envelope = errorEnvelope(res);
      expect(envelope.code).toBe('spend_cap_exceeded');
      const detail = envelope.detail ?? {};
      expect(detail.payer).toBe(fx.payerAddress);
      expect(detail.cap).toBe(1_500);
      expect(detail.spent).toBeGreaterThanOrEqual(1_500);
      expect(typeof detail.reason).toBe('string');
      expect(detail.reason).not.toBe('');
      // Blocked before capture: no pipeline run, no revenue row.
      expect(fx.calls.count).toBe(0);
      expect(makeRevenueRepo(fx.db).summary().requestCount).toBe(requestsBefore);
    } finally {
      await closeSpendFixture(fx);
    }
  });

  it('under-cap payer passes with the identical receipt shape', async () => {
    const fx = makeX402SpendFixture({ spendCapUsdcUnits: 10_000 });
    try {
      makeRevenueRepo(fx.db).record({
        endpoint: 'capture',
        payer: fx.payerAddress,
        revenueUsdcUnits: 1_000,
        costUsdcUnits: 200,
      });
      const res = await paidX402Capture(fx);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        artifact: { format: 'png', bytes: FAKE_PNG.length },
        payment: { payer: fx.payerAddress, priceUsdcUnits: 1_000 },
      });
      expect(fx.calls.count).toBe(1);
    } finally {
      await closeSpendFixture(fx);
    }
  });

  it('caps unset = unlimited: a heavy spender is never blocked by default', async () => {
    const fx = makeX402SpendFixture();
    try {
      const revenue = makeRevenueRepo(fx.db);
      for (let i = 0; i < 5; i += 1) {
        revenue.record({ endpoint: 'capture', payer: fx.payerAddress, revenueUsdcUnits: 1_000, costUsdcUnits: 200 });
      }
      const res = await paidX402Capture(fx);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        payment: { payer: fx.payerAddress, priceUsdcUnits: 1_000 },
      });
      expect(fx.calls.count).toBe(1);
    } finally {
      await closeSpendFixture(fx);
    }
  });
});

describe('B-S1: credits-rail spend caps', () => {
  it('account over cap is blocked (429 or 402 spend_cap_exceeded) with zero capture calls, zero ledger rows, balance untouched', async () => {
    const fx = makeCreditsSpendFixture({ spendCapCredits: 2 });
    try {
      makeCreditsRepo(fx.db).grantCredits(fx.accountId, 10, 'test_seed');
      for (let i = 0; i < 2; i += 1) {
        const ok = await fx.app.inject({
          method: 'POST',
          url: '/v1/capture',
          payload: { url: 'https://example.com/' },
          headers: authHeaders(fx.apiKey),
        });
        expect(ok.statusCode).toBe(200);
      }
      const ledgerBefore = makeCreditsRepo(fx.db).getLedger(fx.accountId).length;
      const balanceBefore = makeAccountsRepo(fx.db).getBalance(fx.accountId);
      expect(balanceBefore).toBe(8);

      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/capture',
        payload: { url: 'https://example.com/' },
        headers: authHeaders(fx.apiKey),
      });
      expect([402, 429]).toContain(res.statusCode);
      const envelope = errorEnvelope(res);
      expect(envelope.code).toBe('spend_cap_exceeded');
      const detail = envelope.detail ?? {};
      expect(detail.payer).toBe(CUSTOMER_ADDRESS);
      expect(detail.cap).toBe(2);
      expect(detail.spent).toBeGreaterThanOrEqual(2);
      expect(typeof detail.reason).toBe('string');
      // Blocked before charge: no pipeline run, no ledger row, no debit.
      expect(fx.calls.count).toBe(2);
      expect(makeCreditsRepo(fx.db).getLedger(fx.accountId)).toHaveLength(ledgerBefore);
      expect(makeAccountsRepo(fx.db).getBalance(fx.accountId)).toBe(balanceBefore);
    } finally {
      await closeSpendFixture(fx);
    }
  });

  it('under-cap account passes with the identical receipt shape', async () => {
    const fx = makeCreditsSpendFixture({ spendCapCredits: 5 });
    try {
      makeCreditsRepo(fx.db).grantCredits(fx.accountId, 2, 'test_seed');
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/capture',
        payload: { url: 'https://example.com/', format: 'jpeg' },
        headers: authHeaders(fx.apiKey),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        artifact: { format: 'jpeg', bytes: FAKE_PNG.length },
        creditsCharged: 1,
        balance: 1,
      });
      expect(fx.calls.count).toBe(1);
    } finally {
      await closeSpendFixture(fx);
    }
  });

  it('caps unset = unlimited: many prior captures never block by default', async () => {
    const fx = makeCreditsSpendFixture();
    try {
      makeCreditsRepo(fx.db).grantCredits(fx.accountId, 10, 'test_seed');
      for (let i = 0; i < 3; i += 1) {
        const res = await fx.app.inject({
          method: 'POST',
          url: '/v1/capture',
          payload: { url: 'https://example.com/' },
          headers: authHeaders(fx.apiKey),
        });
        expect(res.statusCode).toBe(200);
      }
      expect(fx.calls.count).toBe(3);
    } finally {
      await closeSpendFixture(fx);
    }
  });
});

// ---------------------------------------------------------------------------
// B-S2: SSRF surfacing — private hosts carry the guard reason + rebind caveat
// ---------------------------------------------------------------------------

describe('B-S2: SSRF detail on private hosts', () => {
  it('loopback on the credits rail is 422 with detail { reason: guard message, dnsRebindingCaveat: true }', async () => {
    const calls = { count: 0 };
    const fx = makeApiFixture({ capture: stubCapture(calls) });
    try {
      fx.credits.grantCredits(fx.accountId, 1, 'test_seed');
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/capture',
        payload: { url: 'http://127.0.0.1:9999/x' },
        headers: authHeaders(fx.apiKey),
      });
      expect(res.statusCode).toBe(422);
      const envelope = errorEnvelope(res);
      expect(envelope.code).toBe('unprocessable');
      const detail = envelope.detail ?? {};
      expect(detail.reason).toMatch(/not allowed/);
      expect(detail.dnsRebindingCaveat).toBe(true);
      // Rejected before charge and before capture.
      expect(calls.count).toBe(0);
      expect(fx.accounts.getBalance(fx.accountId)).toBe(1);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('private 10/8 on the credits rail is 422 with detail { reason: guard message, dnsRebindingCaveat: true }', async () => {
    const calls = { count: 0 };
    const fx = makeApiFixture({ capture: stubCapture(calls) });
    try {
      fx.credits.grantCredits(fx.accountId, 1, 'test_seed');
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/capture',
        payload: { url: 'http://10.0.0.1/x' },
        headers: authHeaders(fx.apiKey),
      });
      expect(res.statusCode).toBe(422);
      const envelope = errorEnvelope(res);
      expect(envelope.code).toBe('unprocessable');
      const detail = envelope.detail ?? {};
      expect(detail.reason).toMatch(/not allowed/);
      expect(detail.dnsRebindingCaveat).toBe(true);
      expect(calls.count).toBe(0);
      expect(fx.accounts.getBalance(fx.accountId)).toBe(1);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('private host on the free OG surface is 422 with the same SSRF detail', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/v1/og?url=http%3A%2F%2F192.168.1.10%2F' });
      expect(res.statusCode).toBe(422);
      const envelope = errorEnvelope(res);
      expect(envelope.code).toBe('unprocessable');
      const detail = envelope.detail ?? {};
      expect(detail.reason).toMatch(/not allowed/);
      expect(detail.dnsRebindingCaveat).toBe(true);
    } finally {
      await closeApiFixture(fx);
    }
  });
});
