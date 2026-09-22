/**
 * A paid GET must be payable into a working response.
 *
 * Every paid path advertises a 402 for GET as well as POST (the GET challenge
 * is how indexers read a price), and an x402 client retries the method it was
 * challenged on. Before this, that retry reached no route: the payer signed,
 * the response was 405 method_not_allowed, and the customer dead-ended. These
 * tests pin the full wire for the GET form against a mock facilitator, plus the
 * one detail that makes it safe — HEAD must not exist, because HEAD is not in
 * the x402 route table and would run the handler unpaid.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import axios, { type AxiosResponse } from 'axios';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { privateKeyToAccount } from 'viem/accounts';
import { ExactEvmScheme } from '@x402/evm';
import { x402Client } from '@x402/axios';
import { decodePaymentResponseHeader } from '@x402/axios';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import type { PaymentRequired } from '@x402/core/types';
import { openDb, type Db } from '../../src/db/index.js';
import { makeArtifactRepo } from '../../src/db/artifacts.js';
import type { WebcapConfig } from '../../src/config.js';
import { buildApp } from '../../src/server/server.js';
import { buildX402Routes, X402_JOBS_PATH } from '../../src/server/x402/routes.js';
import type { CaptureRequest, CaptureResult, PageStructure, StructuredCapture } from '../../src/capture/pipeline.js';
import { FAKE_PNG } from '../api/fixture.js';
import { makeMockFacilitator, MOCK_SETTLE_TX, type MockFacilitator } from '../helpers/facilitator.js';

const SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const MERCHANT_ADDRESS = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';
const PAYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b786900';
const PAYER_ADDRESS = privateKeyToAccount(PAYER_KEY).address;
const TARGET = 'https://example.com/';

let dir: string;
let db: Db;
let app: FastifyInstance;
let mock: MockFacilitator;
let baseUrl: string;
let config: WebcapConfig;
let captureCalls = 0;

const FAKE_STRUCTURE: PageStructure = {
  title: 'Example Domain',
  description: 'For use in examples.',
  headings: [{ level: 1, text: 'Example Domain' }],
  paragraphs: ['This domain is for use in illustrative examples.'],
  links: [],
  images: [],
  wordCount: 9,
  markdown: '# Example Domain\n\nThis domain is for use in illustrative examples.',
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'webcap-paid-get-'));
  db = openDb(join(dir, 'get.db'));
  mock = makeMockFacilitator('eip155:84532');
  config = {
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
    dbPath: join(dir, 'get.db'),
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
    capture: async (req: CaptureRequest): Promise<CaptureResult> => {
      captureCalls += 1;
      return { buffer: FAKE_PNG, format: req.format ?? 'png', bytes: FAKE_PNG.length };
    },
    captureStructured: async (): Promise<StructuredCapture> => ({
      html: `<html><title>${FAKE_STRUCTURE.title}</title></html>`,
      structure: FAKE_STRUCTURE,
    }),
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

/**
 * A signed payment payload built from the challenge the client actually got.
 *
 * The method has to match: the bazaar extension advertises the live request
 * method (`info.input.method`) and the facilitator rejects a payload whose echo
 * disagrees (`extension_echo_mismatch`). So a GET is signed from the GET
 * challenge, exactly as a real wrapper would.
 */
async function signFor(
  path: string,
  method: 'GET' | 'POST' = 'POST',
  query = `url=${encodeURIComponent(TARGET)}`,
): Promise<{ header: string; challenge: PaymentRequired }> {
  const res =
    method === 'GET'
      ? await app.inject({ method: 'GET', url: `${path}?${query}` })
      : await app.inject({ method: 'POST', url: path, payload: { url: TARGET } });
  expect(res.statusCode, `${path} should challenge`).toBe(402);
  const challenge = res.json() as PaymentRequired;
  const account = privateKeyToAccount(PAYER_KEY);
  const client = new x402Client().register('eip155:*', new ExactEvmScheme(account));
  const payload = await client.createPaymentPayload(challenge);
  return { header: Buffer.from(JSON.stringify(payload)).toString('base64'), challenge };
}

async function paidGet(path: string, query: string, header: string): Promise<AxiosResponse> {
  return axios.get(`${baseUrl}${path}?${query}`, {
    headers: { 'PAYMENT-SIGNATURE': header },
    validateStatus: () => true,
  });
}

describe('paid GET form', () => {
  it('serves the same resource as POST, settled once, with the query as the body', async () => {
    const { header, challenge } = await signFor('/v1/x402/capture', 'GET');
    const before = { ...mock.calls, captures: captureCalls };

    const res = await paidGet('/v1/x402/capture', `url=${encodeURIComponent(TARGET)}`, header);

    expect(res.status).toBe(200);
    const body = res.data as {
      artifact?: { format?: string; bytes?: number; data?: string };
      payment?: { payer?: string; priceUsdcUnits?: number };
    };
    expect(body.artifact?.format).toBe('png');
    expect(body.artifact?.bytes).toBe(FAKE_PNG.length);
    expect(body.payment?.payer?.toLowerCase()).toBe(PAYER_ADDRESS.toLowerCase());
    expect(body.payment?.priceUsdcUnits).toBe(1_000);

    // The query string really was the body: the handler ran and was charged.
    expect(captureCalls).toBe(before.captures + 1);
    expect(mock.calls.settle).toBe(before.settle + 1);
    const settlement = decodePaymentResponseHeader(String(res.headers['payment-response']));
    expect(settlement.success).toBe(true);
    expect(settlement.transaction).toBe(MOCK_SETTLE_TX);

    // Same offer the POST challenge carried — the GET form is not a second price.
    expect(challenge.accepts[0]?.amount).toBe('1000');
  });

  it('carries structured parameters through the query (extract: options as JSON)', async () => {
    const query = `url=${encodeURIComponent(TARGET)}&options=${encodeURIComponent('{"maxContentWords":800}')}`;
    const { header } = await signFor('/v1/x402/extract', 'GET', query);
    const res = await paidGet('/v1/x402/extract', query, header);
    expect(res.status).toBe(200);
    const body = res.data as { results?: Array<{ status?: string }>; payment?: { priceUsdcUnits?: number } };
    expect(body.results?.[0]?.status).toBe('ok');
    expect(body.payment?.priceUsdcUnits).toBe(10_000);
  });

  it('still challenges an unpaid GET with the POST price', async () => {
    const before = mock.calls.settle;
    const res = await app.inject({ method: 'GET', url: `/v1/x402/audit?url=${encodeURIComponent(TARGET)}` });
    expect(res.statusCode).toBe(402);
    const challenge = res.json() as PaymentRequired;
    expect(challenge.accepts[0]?.amount).toBe('2000');
    expect(mock.calls.settle).toBe(before);
  });

  it('does not expose HEAD: it is not in the x402 table, so it cannot run unpaid', async () => {
    const before = { ...mock.calls, captures: captureCalls };
    const res = await axios.head(`${baseUrl}/v1/x402/capture?url=${encodeURIComponent(TARGET)}`, {
      validateStatus: () => true,
    });
    expect(res.status).toBe(405);
    expect(res.headers['allow']).toBe('GET, POST');
    expect(captureCalls).toBe(before.captures);
    expect(mock.calls.settle).toBe(before.settle);
    expect(mock.calls.verify).toBe(before.verify);
  });

  it('keeps POST working unchanged (the documented form)', async () => {
    const { header } = await signFor('/v1/x402/capture', 'POST');
    const res = await axios.post(
      `${baseUrl}/v1/x402/capture`,
      { url: TARGET },
      { headers: { 'PAYMENT-SIGNATURE': header }, validateStatus: () => true },
    );
    expect(res.status).toBe(200);
    expect((res.data as { artifact?: { bytes?: number } }).artifact?.bytes).toBe(FAKE_PNG.length);
  });

  it('every path the x402 table challenges for GET is served for GET, and none for HEAD', () => {
    // The trap this whole change removes: a path that answers a payable GET
    // challenge but has no GET route. Both directions are pinned so a new paid
    // route cannot be added with only one of the two halves.
    const getChallenged = Object.keys(buildX402Routes(config)).filter((key) => key.startsWith('GET '));
    expect(getChallenged.length).toBeGreaterThan(0);
    for (const key of getChallenged) {
      const path = key.slice('GET '.length);
      expect(app.findRoute({ method: 'GET', url: path }), `${path} challenges GET but has no GET route`).not.toBeNull();
      expect(app.findRoute({ method: 'HEAD', url: path }), `${path} must not expose HEAD (it would skip the challenge)`).toBeNull();
    }
    // The paid paths that are deliberately POST-only are not in the GET set.
    expect(getChallenged).not.toContain(`GET ${X402_JOBS_PATH}`);
  });

  it('a paid GET missing a required parameter fails validation, not the shim', async () => {
    // The query string really is the body: without `url` the handler's own
    // check answers, and settlement is cancelled so the payer is not charged.
    const res = await app.inject({ method: 'GET', url: '/v1/x402/capture' });
    expect(res.statusCode).toBe(402);
    const challenge = res.json() as PaymentRequired;
    const account = privateKeyToAccount(PAYER_KEY);
    const client = new x402Client().register('eip155:*', new ExactEvmScheme(account));
    const payload = await client.createPaymentPayload(challenge);
    const header = Buffer.from(JSON.stringify(payload)).toString('base64');
    const before = mock.calls.settle;

    const paid = await axios.get(`${baseUrl}/v1/x402/capture`, {
      headers: { 'PAYMENT-SIGNATURE': header },
      validateStatus: () => true,
    });
    expect(paid.status).toBe(422);
    expect((paid.data as { error?: { message?: string } }).error?.message).toBe('url is required');
    expect(mock.calls.settle).toBe(before);
  });

  it('a paid GET of an unknown watch is rejected without charging the payer', async () => {
    const { header } = await signFor('/v1/x402/watches/topup', 'GET', 'watchId=nope&runs=100');
    const before = mock.calls.settle;
    const res = await paidGet('/v1/x402/watches/topup', 'watchId=nope&runs=100', header);
    expect(res.status).toBe(404);
    // The handler failed, so settlement was cancelled — the same rule as POST.
    expect(mock.calls.settle).toBe(before);
    expect(res.headers['payment-response']).toBeUndefined();
  });
});
