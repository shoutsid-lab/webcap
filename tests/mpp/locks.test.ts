/**
 * MPP SURFACE-gate lock suite (consolidation by design).
 *
 * One file asserting the complete paid-surface contract end to end:
 * (a) POST 402 bodies pinned (MPP changes zero body bytes),
 * (b) all 6 paid patterns (3 routes x POST+GET) carry a recomputable MPP challenge,
 * (c) PAYMENT-REQUIRED header decodes to the identical JSON as the body,
 * (d) mock-facilitator settle, system-level (valid -> 200 + one settle; tampered -> 402 + zero),
 * (e) OpenAPI advertises both {x402:{}} and {mpp:{method:'evm'}} on all 3 paid ops,
 * (f) MPP-disabled is x402-only (additive-only proof).
 *
 * Overlaps per-task tests DELIBERATELY (challenge/header/settle-wire/settle/openapi):
 * those prove each layer, this proves the assembled surface. Per-task internals
 * are NOT duplicated here — only system-level outcomes via HTTP inject.
 *
 * MPP_SECRET_KEY handling: set (32 fixed test bytes, never a real secret) in
 * beforeAll before building the enabled app, restored in afterAll. The disabled
 * app is always built with the secret unset.
 *
 * (f) verification run: MPP_LOCKS_DISABLE=1 npx vitest run tests/mpp/locks.test.ts
 * must turn the MPP assertions ((b), (d)-valid) RED while every x402 assertion
 * ((a), (c), (e), (f), absent-credential) stays GREEN — proving additive-only.
 */
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hexlify, randomBytes, Signature, Wallet } from 'ethers';
import type { FastifyInstance } from 'fastify';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import { openDb, type Db } from '../../src/db/index.js';
import { makeArtifactRepo } from '../../src/db/artifacts.js';
import { WATCH_TOPUP_RUNS, type WebcapConfig } from '../../src/config.js';
import { buildApp } from '../../src/server/server.js';
import { parseWwwAuthenticate } from '../../src/mpp/challenge.js';
import { X402_CAPTURE_PATH, X402_EXTRACT_PATH, X402_TOPUP_PATH } from '../../src/server/x402/routes.js';
import { FAKE_PNG } from '../api/fixture.js';
import { makeMockFacilitator, type MockFacilitator } from '../helpers/facilitator.js';

// Sepolia terms (mirrors tests/mpp/header.test.ts + tests/mpp/settle-wire.test.ts).
const SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const MERCHANT_ADDRESS = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';
const MPP_SECRET_HEX = 'ab'.repeat(32); // 64 bare-hex chars -> 32 bytes, enables MPP (test-only)
const PUBLIC_BASE_URL = 'http://localhost:8080';
const REALM = 'localhost:8080';
const NIL_WATCH_ID = '00000000-0000-4000-8000-000000000000'; // absent watch -> capture-pack fallback
const PAYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b786900';
// Sepolia USDC EIP-712 domain (EIP712_DOMAINS['eip155:84532'] in src/config/chains.ts).
const EIP712 = { name: 'USDC', version: '2', chainId: 84532 } as const;

const TRANSFER_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

const CAPTURE_UNITS = 1_000;
const EXTRACT_UNITS = 10_000;
const TOPUP_FALLBACK_UNITS = WATCH_TOPUP_RUNS * CAPTURE_UNITS; // unknown watch -> 100 x capture pack

// (a) Pinned POST 402 body shas under the sepolia fixture below (sha256 of res.body,
// payload-independent — verified payload/no-payload/{} all hash identically).
// NOTE G1 (adjudicated): 402 bodies embed the deployment config (origin, payTo,
// network), so absolute pins are config-specific. The task-stipulated pins
// (capture 4bbecbfb…/extract 3b301be2…/topup 1562370f…) are the LIVE production
// bodies, re-verified byte-identical at every deploy gate via curl. The pins
// below lock the fixture config instead; the invariant that matters in-test —
// enabled body == disabled body == pin (MPP changes zero body bytes) — holds.
// src/server/x402/* (the directory) is untouched (zero-line diff), so no
// reconciliation needed. (Sibling file src/server/x402.ts carries the +6-line
// settle-hook registration — runtime 402 construction is unaffected.)
const CAPTURE_POST_SHA = '368178997ab44c30390926d7da43fdfb65945ee6f2bcddf8dc4f6af17766d828';
const EXTRACT_POST_SHA = '982f5dead7b7e08fda81616e0dc0f3352b3b511af514e612e8f7e2105d759382';
const TOPUP_POST_SHA = 'c9690b435aa6337fd3d2bf2091bf1499e90b19ad54356268b4a3af13c6f6dafb';

function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

function makeConfig(): WebcapConfig {
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
    dbPath: join(dir, 'x402.db'),
    x402Network: 'eip155:84532',
    x402Asset: SEPOLIA_USDC,
    x402PayTo: MERCHANT_ADDRESS,
    x402PriceUsdcUnits: CAPTURE_UNITS,
    x402ExtractPriceUsdcUnits: EXTRACT_UNITS,
    x402AuditPriceUsdcUnits: 2_000,
    x402VideoPriceUsdcUnits: 5_000,
    computeCostUsdcUnitsPerRequest: 200,
    modelApiBaseUrl: '',
    modelApiKey: '',
    modelName: '',
    x402FacilitatorUrl: 'https://x402.org/facilitator',
    publicBaseUrl: PUBLIC_BASE_URL,
    cdpApiKey: undefined,
  };
}

function buildTestApp(): FastifyInstance {
  return buildApp({
    db,
    config: makeConfig(),
    capture: async () => ({ buffer: FAKE_PNG, format: 'png', bytes: FAKE_PNG.length }),
    captureStructured: async () => {
      throw new Error('must not structure on a surface-lock probe');
    },
    og: async ({ url }) => ({ url, title: 'Stub' }),
    x402Facilitator: mock.facilitator,
    artifacts: makeArtifactRepo(db),
  });
}

let dir: string;
let db: Db;
let mock: MockFacilitator;
let enabled: FastifyInstance;
let disabled: FastifyInstance;
let savedSecret: string | undefined;

interface PaidPattern {
  readonly name: string;
  readonly method: 'POST' | 'GET';
  readonly url: string;
  /** Atomic USDC units the MPP challenge must bind for this pattern. */
  readonly expectedUnits: number;
}

const TOPUP_URL = `${X402_TOPUP_PATH}?watchId=${NIL_WATCH_ID}`;

const PAID_PATTERNS: readonly PaidPattern[] = [
  { name: 'POST capture', method: 'POST', url: X402_CAPTURE_PATH, expectedUnits: CAPTURE_UNITS },
  { name: 'GET capture', method: 'GET', url: X402_CAPTURE_PATH, expectedUnits: CAPTURE_UNITS },
  { name: 'POST extract', method: 'POST', url: X402_EXTRACT_PATH, expectedUnits: EXTRACT_UNITS },
  { name: 'GET extract', method: 'GET', url: X402_EXTRACT_PATH, expectedUnits: EXTRACT_UNITS },
  { name: 'POST topup (nil watch -> capture-pack fallback)', method: 'POST', url: TOPUP_URL, expectedUnits: TOPUP_FALLBACK_UNITS },
  { name: 'GET topup (nil watch -> capture-pack fallback)', method: 'GET', url: TOPUP_URL, expectedUnits: TOPUP_FALLBACK_UNITS },
];

function wwwAuthenticateOf(res: { headers: Record<string, unknown> }): string {
  const header = res.headers['www-authenticate'];
  if (typeof header !== 'string' || header === '') throw new Error('WWW-Authenticate header missing');
  return header;
}

function paymentRequiredOf(res: { headers: Record<string, unknown> }): string {
  const header = res.headers['payment-required'];
  if (typeof header !== 'string' || header === '') throw new Error('PAYMENT-REQUIRED header missing');
  return header;
}

/** A live MPP credential for the given challenge id, signed over the sepolia terms. */
async function authorizationHeader(challengeId: string, value = String(CAPTURE_UNITS)): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const signer = new Wallet(PAYER_KEY);
  const message = {
    from: signer.address,
    to: MERCHANT_ADDRESS,
    value: BigInt(value),
    validAfter: BigInt(now - 10),
    validBefore: BigInt(now + 600),
    nonce: hexlify(randomBytes(32)),
  };
  const signature = await signer.signTypedData(
    { name: EIP712.name, version: EIP712.version, chainId: EIP712.chainId, verifyingContract: SEPOLIA_USDC },
    TRANSFER_TYPES,
    message,
  );
  const sig = Signature.from(signature);
  const credential = {
    from: message.from,
    to: message.to,
    value: message.value.toString(),
    validAfter: message.validAfter.toString(),
    validBefore: message.validBefore.toString(),
    nonce: message.nonce,
    v: sig.v,
    r: sig.r,
    s: sig.s,
    challengeId,
  };
  return `Payment credential="${Buffer.from(JSON.stringify(credential), 'utf8').toString('base64url')}"`;
}

function challengeIdOf(header: string): string {
  const match = /id="([^"]+)"/.exec(header);
  if (match?.[1] === undefined) throw new Error('challenge has no id');
  return match[1];
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'webcap-mpp-locks-'));
  db = openDb(join(dir, 'x402.db'));
  mock = makeMockFacilitator('eip155:84532');
  savedSecret = process.env.MPP_SECRET_KEY;
  // MPP_LOCKS_DISABLE=1 keeps the secret unset for BOTH apps: the (f) RED proof run.
  if (process.env.MPP_LOCKS_DISABLE !== '1') process.env.MPP_SECRET_KEY = MPP_SECRET_HEX;
  else delete process.env.MPP_SECRET_KEY;
  enabled = buildTestApp();
  delete process.env.MPP_SECRET_KEY;
  disabled = buildTestApp();
  if (savedSecret !== undefined) process.env.MPP_SECRET_KEY = savedSecret;
});

afterAll(async () => {
  await enabled.close();
  await disabled.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MPP_SECRET_KEY;
  if (savedSecret !== undefined) process.env.MPP_SECRET_KEY = savedSecret;
});

describe('surface lock (a): POST 402 bodies pinned, MPP changes zero body bytes', () => {
  const cases = [
    { name: 'capture', url: X402_CAPTURE_PATH, pin: CAPTURE_POST_SHA },
    { name: 'extract', url: X402_EXTRACT_PATH, pin: EXTRACT_POST_SHA },
    { name: 'topup (?watchId=nil)', url: TOPUP_URL, pin: TOPUP_POST_SHA },
  ] as const;
  for (const c of cases) {
    it(`POST ${c.name}: body sha256 equals the pin on BOTH apps (byte-identical)`, async () => {
      const live = await enabled.inject({ method: 'POST', url: c.url, payload: { url: 'https://example.com' } });
      expect(live.statusCode).toBe(402);
      expect(sha256Hex(live.body)).toBe(c.pin);
      const plain = await disabled.inject({ method: 'POST', url: c.url, payload: { url: 'https://example.com' } });
      expect(plain.statusCode).toBe(402);
      expect(sha256Hex(plain.body)).toBe(c.pin);
      expect(sha256Hex(live.body)).toBe(sha256Hex(plain.body));
    });
  }
});

describe('surface lock (b): all 6 paid patterns carry a recomputable MPP challenge', () => {
  for (const paid of PAID_PATTERNS) {
    it(`${paid.name}: WWW-Authenticate parses, method=evm, HMAC recomputes, evm terms bound`, async () => {
      const res = await enabled.inject({ method: paid.method, url: paid.url, payload: { url: 'https://example.com' } });
      expect(res.statusCode).toBe(402);
      const header = wwwAuthenticateOf(res);
      expect(header).toContain('method="evm"');
      const parsed = parseWwwAuthenticate(header);
      expect(parsed.realm).toBe(REALM);
      expect(parsed.method).toBe('evm');
      expect(parsed.intent).toBe('charge');
      // Independent HMAC recomputation from parsed fields + test secret (never src internals).
      const secret = Buffer.from(MPP_SECRET_HEX, 'hex');
      const payload = `${parsed.realm}|${parsed.method}|${parsed.intent}|${parsed.request}|${parsed.expires}||`;
      const id = createHmac('sha256', secret).update(payload, 'utf8').digest('base64url');
      expect(parsed.id).toBe(id);
      // Bound evm terms: price identical to x402, authorization credentials, builder chain.
      const requestJson = JSON.parse(Buffer.from(parsed.request, 'base64url').toString('utf8')) as {
        amount: string;
        currency: string;
        recipient: string;
        methodDetails: { chainId: number; credentialTypes: readonly string[]; decimals: number };
      };
      expect(requestJson.amount).toBe((paid.expectedUnits / 1_000_000).toFixed(6));
      expect(requestJson.currency).toBe('USD');
      expect(requestJson.recipient).toBe(MERCHANT_ADDRESS);
      expect(requestJson.methodDetails.credentialTypes).toEqual(['authorization']);
      expect(requestJson.methodDetails.chainId).toBe(84532);
      expect(requestJson.methodDetails.decimals).toBe(6);
    });
  }
});

describe('surface lock (c): PAYMENT-REQUIRED header decodes to the identical JSON as the body', () => {
  const urls = [X402_CAPTURE_PATH, X402_EXTRACT_PATH, TOPUP_URL];
  for (const url of urls) {
    it(`POST ${url}: header challenge deep-equals the body JSON (semantic parity)`, async () => {
      const res = await enabled.inject({ method: 'POST', url, payload: { url: 'https://example.com' } });
      expect(res.statusCode).toBe(402);
      const fromHeader = decodePaymentRequiredHeader(paymentRequiredOf(res));
      expect(fromHeader).toEqual(res.json());
    });
  }
});

describe('surface lock (d): mock-facilitator settle, system-level outcome only', () => {
  it('valid MPP credential -> 200 with exactly one settle', async () => {
    const payer = new Wallet(PAYER_KEY).address;
    const unpaid = await enabled.inject({
      method: 'POST',
      url: X402_CAPTURE_PATH,
      payload: { url: 'https://example.com' },
    });
    expect(unpaid.statusCode).toBe(402);
    const authorization = await authorizationHeader(challengeIdOf(wwwAuthenticateOf(unpaid)));

    const before = { ...mock.calls };
    const paid = await enabled.inject({
      method: 'POST',
      url: X402_CAPTURE_PATH,
      payload: { url: 'https://example.com' },
      headers: { authorization },
    });
    expect(paid.statusCode).toBe(200);
    const body = paid.json() as { artifact: { format: string }; payment: { payer: string; priceUsdcUnits: number } };
    expect(body.payment.payer).toBe(payer);
    expect(body.payment.priceUsdcUnits).toBe(CAPTURE_UNITS);
    expect(body.artifact.format).toBe('png');
    expect(mock.calls.settle).toBe(before.settle + 1);
  });

  it('tampered credential (wrong value) -> 402 with zero settles', async () => {
    const unpaid = await enabled.inject({
      method: 'POST',
      url: X402_CAPTURE_PATH,
      payload: { url: 'https://example.com' },
    });
    expect(unpaid.statusCode).toBe(402);
    const authorization = await authorizationHeader(challengeIdOf(wwwAuthenticateOf(unpaid)), '999');

    const before = { ...mock.calls };
    const res = await enabled.inject({
      method: 'POST',
      url: X402_CAPTURE_PATH,
      payload: { url: 'https://example.com' },
      headers: { authorization },
    });
    expect(res.statusCode).toBe(402);
    expect(mock.calls.settle).toBe(before.settle);
  });

  it('absent credential -> 402 with zero facilitator calls (x402-only fallthrough)', async () => {
    const before = { ...mock.calls };
    const res = await enabled.inject({
      method: 'POST',
      url: X402_CAPTURE_PATH,
      payload: { url: 'https://example.com' },
    });
    expect(res.statusCode).toBe(402);
    expect(mock.calls.verify).toBe(before.verify);
    expect(mock.calls.settle).toBe(before.settle);
    expect(sha256Hex(res.body)).toBe(CAPTURE_POST_SHA);
  });
});

describe('surface lock (e): OpenAPI advertises both protocols on all 3 paid ops', () => {
  it('POST capture/extract/topup list [{x402:{}} , {mpp:{method:evm}}] (x402 first)', async () => {
    const res = await enabled.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json() as {
      paths: Record<string, Record<string, { 'x-payment-info'?: { protocols: readonly unknown[] } } | undefined>>;
    };
    for (const path of [X402_CAPTURE_PATH, X402_EXTRACT_PATH, X402_TOPUP_PATH]) {
      const protocols = doc.paths[path]?.post?.['x-payment-info']?.protocols;
      expect(protocols, `POST ${path} must advertise both protocols`).toEqual([{ x402: {} }, { mpp: { method: 'evm' } }]);
    }
  });
});

describe('surface lock (f): MPP-disabled is x402-only (additive-only proof)', () => {
  it('disabled POST capture: 402, x402 challenge intact, NO WWW-Authenticate, body still pinned', async () => {
    const res = await disabled.inject({ method: 'POST', url: X402_CAPTURE_PATH, payload: { url: 'https://example.com' } });
    expect(res.statusCode).toBe(402);
    expect(typeof res.headers['payment-required']).toBe('string');
    expect(res.headers['www-authenticate']).toBeUndefined();
    expect(sha256Hex(res.body)).toBe(CAPTURE_POST_SHA);
    // x402 parity holds without MPP too.
    const header = res.headers['payment-required'];
    if (typeof header !== 'string') throw new Error('PAYMENT-REQUIRED header missing');
    expect(decodePaymentRequiredHeader(header)).toEqual(res.json());
  });

  it('disabled app settles nothing new: tampered credential is a plain x402 402', async () => {
    const before = { ...mock.calls };
    const res = await disabled.inject({
      method: 'POST',
      url: X402_CAPTURE_PATH,
      payload: { url: 'https://example.com' },
      headers: { authorization: 'Payment credential="e30"' },
    });
    expect(res.statusCode).toBe(402);
    expect(mock.calls.settle).toBe(before.settle);
    expect(sha256Hex(res.body)).toBe(CAPTURE_POST_SHA);
  });
});
