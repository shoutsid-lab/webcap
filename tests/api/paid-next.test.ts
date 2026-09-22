/**
 * Paid next-step guidance on the free surfaces.
 *
 * Context: 100% of webcap traffic is machine, and 9,741 402 challenges in a
 * week produced 2 trial claims and 0 paid calls. The free surfaces are where an
 * agent decides whether to keep going, so they must never dead-end: the trial
 * menu has to hand over the whole priced catalog and the payment flow, even
 * (especially) once every trial is used.
 *
 * The last test guards the invariant that matters: the prices the free menu
 * advertises are the prices the actual 402 challenge asks for.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Wallet } from 'ethers';
import { openDb, type Db } from '../../src/db/index.js';
import { makeArtifactRepo } from '../../src/db/artifacts.js';
import { trialMessage, trialMessageFor, TRIAL_ENDPOINTS } from '../../src/db/trials.js';
import type { WebcapConfig } from '../../src/config.js';
import { buildApp } from '../../src/server/server.js';
import type { CaptureRequest, CaptureResult } from '../../src/capture/pipeline.js';
import type { OgResult } from '../../src/capture/og.js';
import { makeMockFacilitator } from '../helpers/facilitator.js';
import { closeApiFixture, FAKE_PNG, makeApiFixture, MERCHANT_ADDRESS } from './fixture.js';

const SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

interface PaidOption {
  endpoint: string;
  priceUsdcUnits: number;
  priceUsdc: number;
  note: string;
}

interface HowToPay {
  rail: string;
  scheme: string;
  network: string | null;
  asset: string | null;
  payTo: string | null;
  flow: string[];
  guide: string;
  openapi: string;
}

interface StatusBody {
  claimed: string[];
  available: Array<{ endpoint: string; paid: string }>;
  allTrialsUsed: boolean;
  nextStep: string;
  paid: PaidOption[];
  howToPay: HowToPay;
  recurring: { create: string; topUp: string; runs: number; priceUsdc: { capture: number; extract: number } };
}

/** Paid endpoints the catalog must always advertise, with the config field that prices each. */
const EXPECTED_PAID = [
  ['POST /v1/x402/capture', 'x402PriceUsdcUnits'],
  ['POST /v1/x402/extract', 'x402ExtractPriceUsdcUnits'],
  ['POST /v1/x402/audit', 'x402AuditPriceUsdcUnits'],
  ['POST /v1/x402/map-lite', 'x402AuditPriceUsdcUnits'],
  ['POST /v1/x402/video', 'x402VideoPriceUsdcUnits'],
  ['POST /v1/x402/analyze', 'x402ExtractPriceUsdcUnits'],
  ['POST /v1/x402/analyze/batch', 'x402ExtractPriceUsdcUnits'],
] as const;

interface X402Fixture {
  readonly app: FastifyInstance;
  readonly dir: string;
  readonly db: Db;
}

/** Same shape as the other api x402 fixtures: a real network so 402s are produced. */
function makeX402Fixture(): X402Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'webcap-paid-next-'));
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
    captureStructured: async () => ({ html: '<html></html>', structure: {} as never }),
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

function markAllTrialsUsed(db: Db, payer: string): void {
  const insert = db.prepare<[string, string, string]>(
    'INSERT INTO trial_claims (payer, endpoint, created_at) VALUES (?, ?, ?)',
  );
  for (const endpoint of TRIAL_ENDPOINTS) insert.run(payer, endpoint, new Date().toISOString());
}

describe('trial menu hands over the paid path (never a dead end)', () => {
  it('fresh wallet: full priced catalog + howToPay + the recurring watch path', async () => {
    const fx = makeApiFixture();
    try {
      const payer = Wallet.createRandom().address.toLowerCase();
      const res = await fx.app.inject({ method: 'GET', url: `/v1/x402/trial/status?payer=${payer}` });
      expect(res.statusCode).toBe(200);
      const body = res.json() as StatusBody;

      // Every paid endpoint is advertised, priced from config (not hardcoded).
      expect(body.paid.map((p) => p.endpoint)).toEqual(EXPECTED_PAID.map(([endpoint]) => endpoint));
      for (const [endpoint, priceField] of EXPECTED_PAID) {
        const option = body.paid.find((p) => p.endpoint === endpoint);
        expect(option?.priceUsdcUnits).toBe(fx.config[priceField]);
        expect(option?.priceUsdc).toBe(fx.config[priceField] / 1_000_000);
        expect(option?.note.length).toBeGreaterThan(0);
      }

      expect(body.allTrialsUsed).toBe(false);
      expect(body.available.map((a) => a.endpoint)).toEqual([...TRIAL_ENDPOINTS]);
      expect(body.nextStep).toContain('5 free trials left');

      // The payment recipe an agent needs to move from free to paid.
      expect(body.howToPay.rail).toBe('x402');
      expect(body.howToPay.scheme).toBe('exact');
      expect(body.howToPay.flow).toHaveLength(4);
      expect(body.howToPay.guide).toBe(`${fx.config.publicBaseUrl}/skill.md`);
      expect(body.howToPay.openapi).toBe(`${fx.config.publicBaseUrl}/openapi.json`);

      // Recurring (the only subscription-shaped surface) is pointed at too.
      expect(body.recurring).toMatchObject({ create: 'POST /v1/watches', topUp: 'POST /v1/x402/watches/topup', runs: 100 });
      expect(body.recurring.priceUsdc.capture).toBeGreaterThan(0);

      // x402 disabled on this config (local chain) must be reported honestly.
      expect(body.howToPay.network).toBeNull();
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('all five trials used: catalog, howToPay and a concrete nextStep are still returned', async () => {
    const fx = makeApiFixture();
    try {
      const payer = Wallet.createRandom().address.toLowerCase();
      markAllTrialsUsed(fx.db, payer);
      const res = await fx.app.inject({ method: 'GET', url: `/v1/x402/trial/status?payer=${payer}` });
      expect(res.statusCode).toBe(200);
      const body = res.json() as StatusBody;

      // `claimed` reflects row order, not TRIAL_ENDPOINTS order.
      expect(new Set(body.claimed)).toEqual(new Set(TRIAL_ENDPOINTS));
      expect(body.available).toEqual([]);
      expect(body.allTrialsUsed).toBe(true);
      // The regression this guards: an exhausted wallet used to get `available: []`
      // and nothing else — no priced options, no payment instructions.
      expect(body.paid).toHaveLength(EXPECTED_PAID.length);
      expect(body.howToPay.flow.length).toBeGreaterThan(0);
      expect(body.nextStep).toContain('All free trials used');
      expect(body.nextStep).toContain('POST /v1/x402/capture');
      expect(body.nextStep).toContain('$0.001');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('a trial receipt and the 409 both carry howToPay', async () => {
    const fx = makeApiFixture();
    try {
      const wallet = Wallet.createRandom();
      const payer = wallet.address.toLowerCase();
      const signature = await wallet.signMessage(trialMessage(payer));
      const payload = { url: 'https://example.com', payer, signature };

      const first = await fx.app.inject({ method: 'POST', url: '/v1/x402/trial', payload });
      expect(first.statusCode).toBe(200);
      const receipt = first.json() as { remaining: string[]; howToPay: HowToPay; paidNext: { endpoint: string } };
      expect(receipt.howToPay.rail).toBe('x402');
      expect(receipt.howToPay.flow).toHaveLength(4);
      expect(receipt.paidNext.endpoint).toBe('POST /v1/x402/capture');
      expect(receipt.remaining).not.toContain('capture');

      const again = await fx.app.inject({ method: 'POST', url: '/v1/x402/trial', payload });
      expect(again.statusCode).toBe(409);
      const conflict = again.json() as { error: { code: string; detail: { howToPay?: HowToPay; remaining?: string[] } } };
      expect(conflict.error.code).toBe('already_claimed');
      expect(conflict.error.detail.howToPay?.flow).toHaveLength(4);
      expect(conflict.error.detail.remaining).not.toContain('capture');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('advertised prices and rail match the live 402 challenge (no drift)', async () => {
    const fx = makeX402Fixture();
    try {
      const payer = Wallet.createRandom().address.toLowerCase();
      const status = await fx.app.inject({ method: 'GET', url: `/v1/x402/trial/status?payer=${payer}` });
      const body = status.json() as StatusBody;

      const challenge = await fx.app.inject({
        method: 'POST',
        url: '/v1/x402/capture',
        payload: { url: 'https://example.com/' },
      });
      expect(challenge.statusCode).toBe(402);
      const accepts = (challenge.json() as { accepts: Array<{ amount: string; network: string; asset: string; payTo: string; scheme: string }> }).accepts[0];
      expect(accepts).toBeDefined();

      const capture = body.paid.find((p) => p.endpoint === 'POST /v1/x402/capture');
      expect(String(capture?.priceUsdcUnits)).toBe(accepts?.amount);
      expect(body.howToPay.scheme).toBe(accepts?.scheme);
      expect(body.howToPay.network).toBe(accepts?.network);
      expect(body.howToPay.asset).toBe(accepts?.asset);
      expect(body.howToPay.payTo).toBe(accepts?.payTo);
    } finally {
      await closeX402Fixture(fx);
    }
  });

  it('every endpoint claimed individually still yields the same catalog (claim order irrelevant)', async () => {
    const fx = makeApiFixture();
    try {
      const wallet = Wallet.createRandom();
      const payer = wallet.address.toLowerCase();
      // One real HTTP claim (proves the write path) then the rest directly.
      const signature = await wallet.signMessage(trialMessageFor('extract', payer));
      const claimed = await fx.app.inject({
        method: 'POST',
        url: '/v1/x402/trial/extract',
        payload: { url: 'https://example.com', payer, signature },
      });
      expect(claimed.statusCode).toBe(200);
      const rest = TRIAL_ENDPOINTS.filter((e) => e !== 'extract');
      const insert = fx.db.prepare<[string, string, string]>(
        'INSERT INTO trial_claims (payer, endpoint, created_at) VALUES (?, ?, ?)',
      );
      for (const endpoint of rest) insert.run(payer, endpoint, new Date().toISOString());

      const res = await fx.app.inject({ method: 'GET', url: `/v1/x402/trial/status?payer=${payer}` });
      const body = res.json() as StatusBody;
      expect(body.allTrialsUsed).toBe(true);
      expect(body.paid.map((p) => p.endpoint)).toEqual(EXPECTED_PAID.map(([endpoint]) => endpoint));
    } finally {
      await closeApiFixture(fx);
    }
  });
});
