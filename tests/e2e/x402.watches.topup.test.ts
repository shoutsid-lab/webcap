import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import axios, { type AxiosResponse } from 'axios';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { openDb, type Db } from '../../src/db/index.js';
import { makeArtifactRepo } from '../../src/db/artifacts.js';
import { makeWatchRepo } from '../../src/watch/store.js';
import type { WebcapConfig } from '../../src/config.js';
import { buildApp } from '../../src/server/server.js';
import { FAKE_PNG, makeApiFixture, closeApiFixture } from '../api/fixture.js';
import { makeMockFacilitator, type MockFacilitator } from '../helpers/facilitator.js';
import { privateKeyToAccount } from 'viem/accounts';
import { ExactEvmScheme } from '@x402/evm';
import { x402Client, wrapAxiosWithPayment } from '@x402/axios';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from '@x402/core/http';
import type { PaymentRequired, PaymentRequirements } from '@x402/core/types';

const SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const MERCHANT_ADDRESS = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';
const PAYER_KEY_A = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b786900';
const WATCH_URL = 'https://example.com/';

let dir: string;
let db: Db;
let app: FastifyInstance;
let mock: MockFacilitator;
let baseUrl: string;
let publicBaseUrl: string;

const fakeCapture = async (req: { url: string; format?: 'png' | 'jpeg' | 'pdf' }) => ({
  buffer: FAKE_PNG,
  format: req.format ?? ('png' as const),
  bytes: FAKE_PNG.length,
});

function onlyAccept(paymentRequired: PaymentRequired): PaymentRequirements {
  const accept = paymentRequired.accepts[0];
  if (accept === undefined) throw new Error('challenge has no accepts');
  return accept;
}

function challengeFromHeaders(res: { headers: Record<string, unknown> }): PaymentRequired {
  const header = res.headers['payment-required'];
  if (typeof header !== 'string') throw new Error('PAYMENT-REQUIRED header missing');
  return decodePaymentRequiredHeader(header);
}

async function topUpChallenge(watchId: string | undefined): Promise<PaymentRequired> {
  const url = watchId === undefined ? '/v1/x402/watches/topup' : `/v1/x402/watches/topup?watchId=${watchId}`;
  const res = await app.inject({ method: 'POST', url, payload: { watchId: watchId ?? 'unknown', runs: 100 } });
  expect(res.statusCode).toBe(402);
  return res.json() as PaymentRequired;
}

/** POST with a signed payment payload; accepts any status (4xx rejection cases included). */
async function paidTopUp(watchId: string, body: Record<string, unknown>, payload: unknown): Promise<AxiosResponse> {
  const header = Buffer.from(JSON.stringify(payload)).toString('base64');
  return axios.post(`${baseUrl}/v1/x402/watches/topup?watchId=${watchId}`, body, {
    headers: { 'PAYMENT-SIGNATURE': header },
    validateStatus: () => true,
  });
}

function makePayer(key: `0x${string}`) {
  const account = privateKeyToAccount(key);
  return { account, client: new x402Client().register('eip155:*', new ExactEvmScheme(account)) };
}

async function createWatchViaApi(mode: 'capture' | 'extract'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/watches',
    payload: { url: WATCH_URL, every: '1h', mode },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'webcap-x402-topup-'));
  db = openDb(join(dir, 'topup.db'));
  mock = makeMockFacilitator('eip155:84532');
  publicBaseUrl = 'http://localhost:8080';
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
    dbPath: join(dir, 'topup.db'),
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
    publicBaseUrl,
    cdpApiKey: undefined,
  };
  app = buildApp({
    db,
    config,
    capture: fakeCapture,
    captureStructured: async () => ({ html: '<html></html>', structure: { title: 'Stub', description: '', headings: [], paragraphs: [], links: [], images: [], wordCount: 0, markdown: '' } }),
    og: async ({ url }) => ({ url, title: 'Stub' }),
    x402Facilitator: mock.facilitator,
    artifacts: makeArtifactRepo(db),
  });
  // Fastify 5's listen() resolves with the full URL (http://127.0.0.1:port).
  baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
});

afterAll(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('x402 watch top-up (v2 wire, mock facilitator, no chain)', () => {
  it('unpaid capture-watch top-up: 402 challenge priced at 100 x capture unit (100000), bazaar + pinned https resource', async () => {
    const watchId = await createWatchViaApi('capture');
    const challenge = await topUpChallenge(watchId);
    expect(challenge.x402Version).toBe(2);
    expect(challenge.error).toBe('Payment required');
    expect(challenge.resource.url).toBe(`${publicBaseUrl}/v1/x402/watches/topup`);
    expect(challenge.resource).toMatchObject({ mimeType: 'application/json', serviceName: 'Webcap' });
    expect(challenge.resource.tags).toHaveLength(5);
    expect(challenge.resource.iconUrl).toBe(`${publicBaseUrl}/icon.png`);
    expect(onlyAccept(challenge)).toMatchObject({
      scheme: 'exact',
      network: 'eip155:84532',
      asset: SEPOLIA_USDC,
      amount: '100000',
      payTo: MERCHANT_ADDRESS,
      maxTimeoutSeconds: 300,
    });
    expect(onlyAccept(challenge).extra).toMatchObject({ name: 'USDC', version: '2' });
    const bazaar = challenge.extensions?.['bazaar'] as { info: { input: { type: string; method: string; bodyType: string } } } | undefined;
    expect(bazaar?.info.input.type).toBe('http');
    expect(bazaar?.info.input.method).toBe('POST');
    expect(bazaar?.info.input.bodyType).toBe('json');

    // The same challenge rides in PAYMENT-REQUIRED (header == JSON body).
    const res = await app.inject({
      method: 'POST',
      url: `/v1/x402/watches/topup?watchId=${watchId}`,
      payload: { watchId, runs: 100 },
    });
    expect(res.statusCode).toBe(402);
    const header = challengeFromHeaders(res);
    expect(header).toEqual(challenge);
    expect(mock.calls.settle).toBe(0);
  });

  it('unpaid extract-watch top-up: 402 challenge priced at 100 x extract unit (1000000)', async () => {
    const watchId = await createWatchViaApi('extract');
    const challenge = await topUpChallenge(watchId);
    expect(onlyAccept(challenge).amount).toBe('1000000');
    expect(challenge.resource.url).toBe(`${publicBaseUrl}/v1/x402/watches/topup`);
  });

  it('unknown watchId: the 402 falls back to the capture-mode pack price', async () => {
    const challenge = await topUpChallenge('no-such-watch');
    expect(onlyAccept(challenge).amount).toBe('100000');
  });

  it('a real EOA pays the capture pack and the watch gets 100 credits (settled)', async () => {
    const watchId = await createWatchViaApi('capture');
    const { account, client } = makePayer(PAYER_KEY_A);
    const api = wrapAxiosWithPayment(axios.create({ baseURL: baseUrl }), client);
    const res = await api.post(`/v1/x402/watches/topup?watchId=${watchId}`, { watchId, runs: 100 });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ watchId, credits: 100, priceUsdcUnits: 100_000 });
    expect(mock.calls.verify).toBeGreaterThanOrEqual(1);
    expect(mock.calls.settle).toBeGreaterThanOrEqual(1);
    const settlement = mock.settlements[mock.settlements.length - 1];
    if (settlement === undefined) throw new Error('no settlement recorded');
    expect(settlement.requirements.payTo).toBe(MERCHANT_ADDRESS);
    expect(settlement.requirements.amount).toBe('100000');
    const response = decodePaymentResponseHeader(String(res.headers['payment-response']));
    expect(response.success).toBe(true);
    expect(response.payer).toBe(account.address);

    const repo = makeWatchRepo(db);
    const row = repo.get(watchId);
    if (row === null) throw new Error('watch vanished');
    expect(row.credits).toBe(100);
    expect(row.paused).toBe(0);
    // Cost-free revenue ledger row for the settled top-up.
    const ledger = db.prepare<[string], { endpoint: string; revenue_usdc: number; cost_usdc: number }>(
      'SELECT endpoint, revenue_usdc, cost_usdc FROM revenue_ledger WHERE endpoint = ? ORDER BY id DESC LIMIT 1',
    );
    expect(ledger.get('watch-topup')).toMatchObject({ endpoint: 'watch-topup', revenue_usdc: 100_000, cost_usdc: 0 });
  });

  it('a real EOA pays the extract pack and the watch gets 100 credits (settled at 1000000)', async () => {
    const watchId = await createWatchViaApi('extract');
    const { client } = makePayer(PAYER_KEY_A);
    const api = wrapAxiosWithPayment(axios.create({ baseURL: baseUrl }), client);
    const res = await api.post(`/v1/x402/watches/topup?watchId=${watchId}`, { watchId, runs: 100 });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ watchId, credits: 100, priceUsdcUnits: 1_000_000 });
    const settlement = mock.settlements[mock.settlements.length - 1];
    if (settlement === undefined) throw new Error('no settlement recorded');
    expect(settlement.requirements.amount).toBe('1000000');
  });

  it('a top-up resumes a paused, credit-exhausted watch (paused 0, next_run_at rescheduled)', async () => {
    const repo = makeWatchRepo(db);
    const watchId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    repo.create({
      id: watchId,
      url: WATCH_URL,
      every: '1h',
      mode: 'capture',
      schemaJson: null,
      webhookUrl: null,
      conditionsJson: null,
      channel: 'generic',
      credits: 0,
      nextRunAt: '2026-01-01T00:00:00.000Z',
      createdAt: nowIso,
    });
    repo.pause(watchId); // the no-credit state

    const { client } = makePayer(PAYER_KEY_A);
    const api = wrapAxiosWithPayment(axios.create({ baseURL: baseUrl }), client);
    const res = await api.post(`/v1/x402/watches/topup?watchId=${watchId}`, { watchId, runs: 100 });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ watchId, credits: 100 });

    const row = repo.get(watchId);
    if (row === null) throw new Error('watch vanished');
    expect(row.paused).toBe(0);
    expect(row.credits).toBe(100);
    expect(row.next_run_at).not.toBeNull();
    expect(new Date(row.next_run_at ?? '').getTime()).toBeGreaterThan(Date.parse(nowIso) - 5_000);
  });

  it('paid request with an unknown watchId: 404 not_found, no settlement', async () => {
    const before = { ...mock.calls };
    const challenge = await topUpChallenge('no-such-watch');
    const { client } = makePayer(PAYER_KEY_A);
    const res = await paidTopUp('no-such-watch', { watchId: 'no-such-watch', runs: 100 }, await client.createPaymentPayload(challenge));
    expect(res.status).toBe(404);
    expect((res.data as { error: { code: string } }).error.code).toBe('not_found');
    expect(mock.calls.settle).toBe(before.settle);
  });

  it('paid request with a bad body (runs != 100 / missing watchId): 400, no settlement', async () => {
    const watchId = await createWatchViaApi('capture');
    const before = { ...mock.calls };
    const challenge = await topUpChallenge(watchId);
    const { client } = makePayer(PAYER_KEY_A);
    for (const body of [{ watchId, runs: 50 }, { runs: 100 }, { watchId: 42, runs: 100 }]) {
      const res = await paidTopUp(watchId, body, await client.createPaymentPayload(challenge));
      expect(res.status).toBe(400);
      expect((res.data as { error: { code: string } }).error.code).toBe('bad_request');
    }
    expect(mock.calls.settle).toBe(before.settle);
  });
});
