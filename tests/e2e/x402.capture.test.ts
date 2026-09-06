import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import axios, { type AxiosResponse } from 'axios';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { openDb, type Db } from '../../src/db/index.js';
import { makeArtifactRepo } from '../../src/db/artifacts.js';
import { USDC_SCALE, WATCH_TOPUP_RUNS } from '../../src/config.js';
import type { WebcapConfig } from '../../src/config.js';
import { buildApp } from '../../src/server/server.js';
import type { CaptureRequest, CaptureResult, PageStructure, StructuredCapture } from '../../src/capture/pipeline.js';
import { closeApiFixture, FAKE_PNG, makeApiFixture } from '../api/fixture.js';
import { makeMockFacilitator, MOCK_SETTLE_TX, type MockFacilitator } from '../helpers/facilitator.js';
import { privateKeyToAccount } from 'viem/accounts';
import { ExactEvmScheme } from '@x402/evm';
import { decodePaymentResponseHeader, x402Client, wrapAxiosWithPayment } from '@x402/axios';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import type { PaymentRequired, PaymentRequirements } from '@x402/core/types';

const SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const MAINNET_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const MERCHANT_ADDRESS = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';
const PAYER_KEY_A = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b786900';
const PAYER_KEY_B = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
const CAPTURE_URL = 'https://example.com';

let dir: string;
let db: Db;
let app: FastifyInstance;
let mock: MockFacilitator;
let baseUrl: string;
let captureCalls = 0;

const fakeCapture = async (req: CaptureRequest): Promise<CaptureResult> => {
  captureCalls += 1;
  return { buffer: FAKE_PNG, format: req.format ?? 'png', bytes: FAKE_PNG.length };
};

const FAKE_STRUCTURE: PageStructure = {
  title: 'Example Domain',
  description: 'For use in examples.',
  headings: [{ level: 1, text: 'Example Domain' }],
  paragraphs: ['This domain is for use in illustrative examples.'],
  links: [{ href: 'https://www.iana.org/domains/example', text: 'More information...' }],
  images: [],
  wordCount: 9,
  markdown: '# Example Domain\n\nThis domain is for use in illustrative examples.',
};
const fakeCaptureStructured = async (): Promise<StructuredCapture> => ({
  html: `<html><title>${FAKE_STRUCTURE.title}</title></html>`,
  structure: FAKE_STRUCTURE,
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

async function getChallenge(): Promise<PaymentRequired> {
  const res = await app.inject({ method: 'POST', url: '/v1/x402/capture', payload: { url: CAPTURE_URL } });
  expect(res.statusCode).toBe(402);
  return res.json() as PaymentRequired;
}

async function paidPost(payload: unknown): Promise<AxiosResponse> {
  const header = Buffer.from(JSON.stringify(payload)).toString('base64');
  return axios.post(`${baseUrl}/v1/x402/capture`, { url: CAPTURE_URL }, {
    headers: { 'PAYMENT-SIGNATURE': header },
    validateStatus: (status) => status === 402,
  });
}

function makePayer(key: `0x${string}`) {
  const account = privateKeyToAccount(key);
  return { account, client: new x402Client().register('eip155:*', new ExactEvmScheme(account)) };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'webcap-x402-'));
  db = openDb(join(dir, 'x402.db'));
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
  app = buildApp({
    db,
    config,
    capture: fakeCapture,
    captureStructured: fakeCaptureStructured,
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

describe('x402 capture (v2 wire, mock facilitator, no chain)', () => {
  it('S1: an unpaid request returns 402 with a valid x402 v2 challenge', async () => {
    const before = { ...mock.calls };
    const challenge = await getChallenge();
    expect(challenge.x402Version).toBe(2);
    expect(challenge.error).toBe('Payment required');
    expect(challenge.resource.url).toContain('/v1/x402/capture');
    expect(challenge.resource).toMatchObject({ mimeType: 'application/json' });
    expect(onlyAccept(challenge)).toMatchObject({
      scheme: 'exact',
      network: 'eip155:84532',
      asset: SEPOLIA_USDC,
      amount: '1000',
      payTo: MERCHANT_ADDRESS,
      maxTimeoutSeconds: 300,
    });
    expect(onlyAccept(challenge).extra).toMatchObject({ name: 'USDC', version: '2' });
    // Canonical v2 wire: the same challenge also rides in PAYMENT-REQUIRED.
    const res = await app.inject({ method: 'POST', url: '/v1/x402/capture', payload: { url: CAPTURE_URL } });
    expect(res.statusCode).toBe(402);
    expect(challengeFromHeaders(res)).toEqual(challenge);
    expect(captureCalls).toBe(0);
    expect(mock.calls.settle).toBe(before.settle);
  });

  it('S6: the 402 challenge carries bazaar service metadata in both the header and the body', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/x402/capture', payload: { url: CAPTURE_URL } });
    expect(res.statusCode).toBe(402);
    const header = challengeFromHeaders(res);
    expect(header.resource.serviceName).toBe('Webcap');
    expect(header.resource.tags).toHaveLength(5);
    expect(header.resource.iconUrl).toMatch(/\/icon\.png$/);
    const headerBazaar = header.extensions?.['bazaar'] as { info: { input: { type: string } } } | undefined;
    expect(headerBazaar?.info.input.type).toBe('http');
    const body = res.json() as PaymentRequired;
    expect(body.resource.serviceName).toBe('Webcap');
    expect(body.resource.tags).toHaveLength(5);
    expect(body.resource.iconUrl).toMatch(/\/icon\.png$/);
    const bodyBazaar = body.extensions?.['bazaar'] as { info: { input: { type: string } } } | undefined;
    expect(bodyBazaar?.info.input.type).toBe('http');
    // the JSON body is a static mirror of the enriched PAYMENT-REQUIRED header
    expect(body.extensions).toEqual(header.extensions);
  });

  it('S4: GET /v1/x402/service returns the agent-discoverable catalog', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/x402/service' });
    expect(res.statusCode).toBe(200);
    const svc = res.json() as {
      service: string;
      paymentProtocol: string;
      x402Version: number;
      paidEndpoints: Array<{ method: string; path: string; priceUsdc: number; atomicUnits: string }>;
      price: { asset: string; network: string; payTo: string; scheme: string };
      facilitator: string;
      howToPay: string;
    };
    expect(svc.service).toBe('webcap');
    expect(svc.paymentProtocol).toBe('x402');
    expect(svc.x402Version).toBe(2);
    expect(svc.paidEndpoints).toEqual([
      expect.objectContaining({ method: 'POST', path: '/v1/x402/capture', priceUsdc: 0.001, atomicUnits: '1000' }),
      expect.objectContaining({ method: 'POST', path: '/v1/x402/extract', priceUsdc: 0.01, atomicUnits: '10000' }),
      expect.objectContaining({ method: 'POST', path: '/v1/x402/audit', priceUsdc: 0.002, atomicUnits: '2000' }),
      expect.objectContaining({ method: 'POST', path: '/v1/x402/map-lite', priceUsdc: 0.002, atomicUnits: '2000' }),
      expect.objectContaining({ method: 'POST', path: '/v1/x402/video', priceUsdc: 0.005, atomicUnits: '5000' }),
      // Watch top-up pack: WATCH_TOPUP_RUNS × capture unit price (config-derived in routes.ts).
      expect.objectContaining({
        method: 'POST',
        path: '/v1/x402/watches/topup',
        priceUsdc: (1_000 * WATCH_TOPUP_RUNS) / USDC_SCALE,
        atomicUnits: String(1_000 * WATCH_TOPUP_RUNS),
      }),
    ]);
    expect(svc.price).toMatchObject({
      asset: SEPOLIA_USDC,
      network: 'eip155:84532',
      payTo: MERCHANT_ADDRESS,
      scheme: 'exact',
    });
    expect(svc.facilitator).toBe('https://x402.org/facilitator');
    expect(typeof svc.howToPay).toBe('string');
  });

  it('S2: a real EOA pays gaslessly (EIP-3009) and gets the capture + settlement receipt', async () => {
    const { account, client } = makePayer(PAYER_KEY_A);
    const api = wrapAxiosWithPayment(axios.create({ baseURL: baseUrl }), client);
    const res = await api.post('/v1/x402/capture', { url: CAPTURE_URL });
    expect(res.status).toBe(200);
    expect(res.data.artifact).toMatchObject({ format: 'png', bytes: FAKE_PNG.length });
    expect(Buffer.from(res.data.artifact.data, 'base64')).toEqual(FAKE_PNG);
    expect(res.data.payment).toMatchObject({ payer: account.address, priceUsdcUnits: 1_000 });
    expect(captureCalls).toBe(1);
    expect(mock.calls.verify).toBeGreaterThanOrEqual(1);
    expect(mock.calls.settle).toBe(1);
    const settled = mock.settlements[0];
    if (settled === undefined) throw new Error('no settlement recorded');
    expect(settled.requirements.payTo).toBe(MERCHANT_ADDRESS);
    expect(settled.requirements.amount).toBe('1000');
    const settlement = decodePaymentResponseHeader(String(res.headers['payment-response']));
    expect(settlement.success).toBe(true);
    expect(settlement.transaction).toBe(MOCK_SETTLE_TX);
    expect(settlement.payer).toBe(account.address);
  });

  it('S5: the paid 200 response carries a persistent public artifact.url', async () => {
    const { client } = makePayer(PAYER_KEY_B);
    const api = wrapAxiosWithPayment(axios.create({ baseURL: baseUrl }), client);
    const res = await api.post('/v1/x402/capture', { url: CAPTURE_URL });
    expect(res.status).toBe(200);
    const url = res.data.artifact.url as string;
    expect(url).toMatch(/^https?:\/\/[^/]+\/v1\/artifacts\/[0-9a-f-]{36}$/);
  });

  it('S3a: an underpaid authorization is rejected (402, no handler, no settle)', async () => {
    const before = { ...mock.calls, captures: captureCalls };
    const challenge = await getChallenge();
    const underpaid = { ...challenge, accepts: [{ ...onlyAccept(challenge), amount: '999' }] };
    const { client } = makePayer(PAYER_KEY_A);
    const res = await paidPost(await client.createPaymentPayload(underpaid));
    expect(res.status).toBe(402);
    expect(challengeFromHeaders(res).x402Version).toBe(2);
    expect(mock.calls.verify).toBe(before.verify);
    expect(mock.calls.settle).toBe(before.settle);
    expect(captureCalls).toBe(before.captures);
  });

  it('S3b: a foreign-network payment is rejected (402, no handler, no settle)', async () => {
    const before = { ...mock.calls, captures: captureCalls };
    const challenge = await getChallenge();
    const foreign: PaymentRequired = {
      ...challenge,
      accepts: [
        { ...onlyAccept(challenge), network: 'eip155:8453', asset: MAINNET_USDC, extra: { name: 'USD Coin', version: '2' } },
      ],
    };
    const { client } = makePayer(PAYER_KEY_A);
    const res = await paidPost(await client.createPaymentPayload(foreign));
    expect(res.status).toBe(402);
    expect(challengeFromHeaders(res).x402Version).toBe(2);
    expect(mock.calls.verify).toBe(before.verify);
    expect(mock.calls.settle).toBe(before.settle);
    expect(captureCalls).toBe(before.captures);
  });

  it('S3c: an authorization signed by a different EOA than `from` is rejected (402, no handler, no settle)', async () => {
    const before = { ...mock.calls, captures: captureCalls };
    const challenge = await getChallenge();
    const { client } = makePayer(PAYER_KEY_A);
    const payload = await client.createPaymentPayload(challenge);
    const auth = payload.payload['authorization'] as { from: string };
    auth.from = privateKeyToAccount(PAYER_KEY_B).address;
    const res = await paidPost(payload);
    expect(res.status).toBe(402);
    expect(challengeFromHeaders(res).error).toMatch(/signature/);
    expect(mock.calls.verify).toBe(before.verify + 1);
    expect(mock.calls.settle).toBe(before.settle);
    expect(captureCalls).toBe(before.captures);
  });

  it('local chain: the route is present but returns 503 x402_disabled', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'POST', url: '/v1/x402/capture', payload: { url: CAPTURE_URL } });
      expect(res.statusCode).toBe(503);
      const envelope = res.json() as { error: { code: string; message: string } };
      expect(envelope.error.code).toBe('x402_disabled');
      expect(envelope.error.message).toMatch(/base-sepolia or base/);
    } finally {
      await closeApiFixture(fx);
    }
  });
});

describe('x402 GET-route discoverability (402 challenge on GET, identical to POST)', () => {
  it('GET /v1/x402/capture returns 402 (not 404) with the x402 challenge', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/x402/capture' });
    expect(res.statusCode).toBe(402);
    const body = res.json() as { error: string; resource: { url: string }; accepts: unknown[] };
    expect(body.error).toBe('Payment required');
    expect(body.resource.url).toContain('/v1/x402/capture');
    expect(Array.isArray(body.accepts)).toBe(true);
    expect(body.accepts.length).toBeGreaterThan(0);
  });

  it('GET /v1/x402/extract returns 402 (not 404) with the x402 challenge', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/x402/extract' });
    expect(res.statusCode).toBe(402);
    const body = res.json() as { error: string; resource: { url: string } };
    expect(body.error).toBe('Payment required');
    expect(body.resource.url).toContain('/v1/x402/extract');
  });

  it('GET /v1/x402/watches/topup returns 402 (not 404) with the x402 challenge', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/x402/watches/topup' });
    expect(res.statusCode).toBe(402);
    const body = res.json() as { error: string; resource: { url: string } };
    expect(body.error).toBe('Payment required');
    expect(body.resource.url).toContain('/v1/x402/watches/topup');
  });

  it('POST /v1/x402/capture still returns the identical 402 challenge (no behavior change)', async () => {
    const getRes = await app.inject({ method: 'GET', url: '/v1/x402/capture' });
    const postRes = await app.inject({ method: 'POST', url: '/v1/x402/capture', payload: { url: CAPTURE_URL } });
    expect(getRes.statusCode).toBe(402);
    expect(postRes.statusCode).toBe(402);
    const getBody = getRes.json() as { accepts: Array<{ amount: string }> };
    const postBody = postRes.json() as { accepts: Array<{ amount: string }> };
    expect(getBody.accepts[0]?.amount).toBe(postBody.accepts[0]?.amount);
  });
});

describe('x402 GET 402 method parity: the body bazaar matches the enriched PAYMENT-REQUIRED header', () => {
  interface BazaarShape {
    info: { input: { type: string; method: string } };
    schema: { properties: { input: { properties: Record<string, { enum?: readonly string[] }> } } };
  }

  const methodEnumOf = (bazaar: BazaarShape): readonly string[] | undefined =>
    bazaar.schema.properties.input.properties['method']?.enum;

  for (const path of ['/v1/x402/capture', '/v1/x402/extract', '/v1/x402/watches/topup'] as const) {
    it(`GET ${path}: the 402 body extensions deep-equal the header's, both pinning the actual method (GET)`, async () => {
      const res = await app.inject({ method: 'GET', url: path });
      expect(res.statusCode).toBe(402);
      const header = challengeFromHeaders(res);
      const body = res.json() as PaymentRequired;
      const headerBazaar = header.extensions?.['bazaar'] as BazaarShape | undefined;
      const bodyBazaar = body.extensions?.['bazaar'] as BazaarShape | undefined;
      if (headerBazaar === undefined || bodyBazaar === undefined) throw new Error('bazaar extension missing from 402');
      // the middleware enriches the header with the actual request method; the
      // static JSON body mirror must carry the same method, not a pinned POST
      expect(headerBazaar.info.input.method).toBe('GET');
      expect(body.extensions).toEqual(header.extensions);
      expect(methodEnumOf(headerBazaar)).toEqual(['GET']);
      expect(methodEnumOf(bodyBazaar)).toEqual(['GET']);
    });
  }
});
