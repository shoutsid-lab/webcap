import { describe, expect, it } from 'vitest';
import { Wallet, Signature, randomBytes, hexlify } from 'ethers';
import type { FastifyRequest } from 'fastify';
import { x402ResourceServer } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import type { PaymentRequirements } from '@x402/core/types';
import { buildWwwAuthenticate } from '../../src/mpp/challenge.js';
import { settleMppPayment } from '../../src/mpp/settle.js';
import { x402Payer } from '../../src/server/x402.js';
import { makeMockFacilitator, type MockFacilitator } from '../helpers/facilitator.js';

// Base mainnet terms (read-only mirrors of src/config/chains.ts).
const NETWORK = 'eip155:8453';
const ASSET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PAY_TO = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';
const AMOUNT = '1000';
const REALM = 'https://example.com';
const SECRET = Buffer.from('ab'.repeat(32), 'hex');
const EIP712 = { name: 'USD Coin', version: '2', chainId: 8453 } as const;

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

const PAYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b786900';

function requirements(): PaymentRequirements {
  return {
    scheme: 'exact',
    network: NETWORK,
    asset: ASSET,
    amount: AMOUNT,
    payTo: PAY_TO,
    maxTimeoutSeconds: 300,
    extra: { name: EIP712.name, version: EIP712.version },
  };
}

function challengeHeader(expiresAtSec: number): string {
  return buildWwwAuthenticate({
    amountUsdcUnits: Number(AMOUNT),
    recipient: PAY_TO,
    realm: REALM,
    method: 'evm',
    intent: 'charge',
    secret: SECRET,
    expiresAtSec,
    chainId: EIP712.chainId,
  });
}

interface CredentialOverrides {
  readonly to?: string;
  readonly value?: string;
  readonly validAfter?: string;
  readonly validBefore?: string;
  readonly challengeId?: string;
  readonly signerKey?: string;
  readonly fromOverride?: string;
}

async function authorizationHeader(
  challengeId: string,
  overrides: CredentialOverrides = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const signer = new Wallet(overrides.signerKey ?? PAYER_KEY);
  const message = {
    from: signer.address,
    to: overrides.to ?? PAY_TO,
    value: BigInt(overrides.value ?? AMOUNT),
    validAfter: BigInt(overrides.validAfter ?? String(now - 10)),
    validBefore: BigInt(overrides.validBefore ?? String(now + 600)),
    nonce: hexlify(randomBytes(32)),
  };
  const signature = await signer.signTypedData(
    { name: EIP712.name, version: EIP712.version, chainId: EIP712.chainId, verifyingContract: ASSET },
    TRANSFER_TYPES,
    message,
  );
  const sig = Signature.from(signature);
  const credential = {
    from: overrides.fromOverride ?? message.from,
    to: message.to,
    value: message.value.toString(),
    validAfter: message.validAfter.toString(),
    validBefore: message.validBefore.toString(),
    nonce: message.nonce,
    v: sig.v,
    r: sig.r,
    s: sig.s,
    challengeId: overrides.challengeId ?? challengeId,
  };
  return `Payment credential="${Buffer.from(JSON.stringify(credential), 'utf8').toString('base64url')}"`;
}

function challengeIdOf(header: string): string {
  const match = /id="([^"]+)"/.exec(header);
  if (match?.[1] === undefined) throw new Error('challenge has no id');
  return match[1];
}

function setup() {
  const mock: MockFacilitator = makeMockFacilitator(NETWORK);
  const resourceServer = new x402ResourceServer(mock.facilitator).register(NETWORK, new ExactEvmScheme());
  return { mock, resourceServer };
}

const nowSec = (): number => Math.floor(Date.now() / 1000);

describe('mpp settle: valid credential settles through the existing facilitator path', () => {
  it('returns 200-settled with payer context attached (x402Payer-compatible)', async () => {
    const { mock, resourceServer } = setup();
    const challenge = challengeHeader(nowSec() + 300);
    const authorization = await authorizationHeader(challengeIdOf(challenge));
    const result = await settleMppPayment({
      authorizationHeader: authorization,
      challengeHeader: challenge,
      requirements: requirements(),
      secret: SECRET,
      realm: REALM,
      resourceServer,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const payer = new Wallet(PAYER_KEY).address;
    expect(result.payer).toBe(payer);
    expect(result.settlement.success).toBe(true);
    expect(mock.calls.verify).toBe(1);
    expect(mock.calls.settle).toBe(1);
    // Payer context rides the standard x402 payload shape downstream.
    const auth = result.paymentPayload.payload['authorization'] as { from?: unknown };
    expect(auth.from).toBe(payer);
    expect(result.paymentPayload.accepted.amount).toBe(AMOUNT);
    const req = { x402Context: { paymentPayload: result.paymentPayload } } as unknown as FastifyRequest;
    expect(x402Payer(req)).toBe(payer);
  });
});

describe('mpp settle: absent Authorization falls through to the x402 402 unchanged', () => {
  it('missing header returns missing_authorization with zero facilitator calls (no throw, no loop)', async () => {
    const { mock, resourceServer } = setup();
    const challenge = challengeHeader(nowSec() + 300);
    for (const authorizationHeader of [undefined, '']) {
      const result = await settleMppPayment({
        authorizationHeader,
        challengeHeader: challenge,
        requirements: requirements(),
        secret: SECRET,
        realm: REALM,
        resourceServer,
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.reason).toBe('missing_authorization');
    }
    expect(mock.calls.verify).toBe(0);
    expect(mock.calls.settle).toBe(0);
  });

  it('a non-Payment scheme never settles (header-only looping impossible)', async () => {
    const { mock, resourceServer } = setup();
    const challenge = challengeHeader(nowSec() + 300);
    for (const authorizationHeader of ['Bearer abc123', 'Basic Zm9vOmJhcg==', 'Payment foo="bar"']) {
      const result = await settleMppPayment({
        authorizationHeader,
        challengeHeader: challenge,
        requirements: requirements(),
        secret: SECRET,
        realm: REALM,
        resourceServer,
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
    }
    expect(mock.calls.verify).toBe(0);
    expect(mock.calls.settle).toBe(0);
  });

  it('a corrupt credential encoding never settles and never throws', async () => {
    const { mock, resourceServer } = setup();
    const challenge = challengeHeader(nowSec() + 300);
    for (const authorizationHeader of [
      'Payment credential="!!!not-base64!!!"',
      `Payment credential="${Buffer.from('not json', 'utf8').toString('base64url')}"`,
      `Payment credential="${Buffer.from('{"from":1}', 'utf8').toString('base64url')}"`,
    ]) {
      const result = await settleMppPayment({
        authorizationHeader,
        challengeHeader: challenge,
        requirements: requirements(),
        secret: SECRET,
        realm: REALM,
        resourceServer,
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
    }
    expect(mock.calls.verify).toBe(0);
    expect(mock.calls.settle).toBe(0);
  });
});

describe('mpp settle: HMAC vs expiry vs signature vs amount taxonomy', () => {
  it('HMAC: a tampered challenge id fails closed with zero crypto/facilitator calls', async () => {
    const { mock, resourceServer } = setup();
    const challenge = challengeHeader(nowSec() + 300).replace(/id="[^"]+"/, 'id="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"');
    const authorization = await authorizationHeader(challengeIdOf(challengeHeader(nowSec() + 300)));
    const result = await settleMppPayment({
      authorizationHeader: authorization,
      challengeHeader: challenge,
      requirements: requirements(),
      secret: SECRET,
      realm: REALM,
      resourceServer,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('challenge_id_mismatch');
    expect(mock.calls.verify).toBe(0);
    expect(mock.calls.settle).toBe(0);
  });

  it('HMAC: a credential bound to a different challenge id fails closed', async () => {
    const { mock, resourceServer } = setup();
    const challenge = challengeHeader(nowSec() + 300);
    const authorization = await authorizationHeader('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    const result = await settleMppPayment({
      authorizationHeader: authorization,
      challengeHeader: challenge,
      requirements: requirements(),
      secret: SECRET,
      realm: REALM,
      resourceServer,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('challenge_id_mismatch');
    expect(mock.calls.verify).toBe(0);
    expect(mock.calls.settle).toBe(0);
  });

  it('expiry: an expired challenge is rejected BEFORE any signature recovery', async () => {
    const { mock, resourceServer } = setup();
    const challenge = challengeHeader(nowSec() - 60);
    const authorization = await authorizationHeader(challengeIdOf(challenge));
    const result = await settleMppPayment({
      authorizationHeader: authorization,
      challengeHeader: challenge,
      requirements: requirements(),
      secret: SECRET,
      realm: REALM,
      resourceServer,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('challenge_expired');
    expect(mock.calls.verify).toBe(0);
    expect(mock.calls.settle).toBe(0);
  });

  it('amount: a correctly-signed authorization for the wrong value is rejected with no settle', async () => {
    const { mock, resourceServer } = setup();
    const challenge = challengeHeader(nowSec() + 300);
    const authorization = await authorizationHeader(challengeIdOf(challenge), { value: '999' });
    const result = await settleMppPayment({
      authorizationHeader: authorization,
      challengeHeader: challenge,
      requirements: requirements(),
      secret: SECRET,
      realm: REALM,
      resourceServer,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('amount_mismatch');
    expect(mock.calls.settle).toBe(0);
  });

  it('recipient: a correctly-signed authorization to the wrong payTo is rejected with no settle', async () => {
    const { mock, resourceServer } = setup();
    const challenge = challengeHeader(nowSec() + 300);
    const authorization = await authorizationHeader(challengeIdOf(challenge), {
      to: '0x000000000000000000000000000000000000dEaD',
    });
    const result = await settleMppPayment({
      authorizationHeader: authorization,
      challengeHeader: challenge,
      requirements: requirements(),
      secret: SECRET,
      realm: REALM,
      resourceServer,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('recipient_mismatch');
    expect(mock.calls.settle).toBe(0);
  });

  it('signature: a from-field swapped after signing fails recovery with no settle', async () => {
    const { mock, resourceServer } = setup();
    const challenge = challengeHeader(nowSec() + 300);
    const authorization = await authorizationHeader(challengeIdOf(challenge), {
      fromOverride: '0x000000000000000000000000000000000000dEaD',
    });
    const result = await settleMppPayment({
      authorizationHeader: authorization,
      challengeHeader: challenge,
      requirements: requirements(),
      secret: SECRET,
      realm: REALM,
      resourceServer,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('invalid_signature');
    expect(mock.calls.settle).toBe(0);
  });

  it('window: an authorization outside its validAfter/validBefore window is rejected with no settle', async () => {
    const { mock, resourceServer } = setup();
    const challenge = challengeHeader(nowSec() + 300);
    const now = nowSec();
    for (const window of [
      { validAfter: String(now - 1200), validBefore: String(now - 600) },
      { validAfter: String(now + 600), validBefore: String(now + 1200) },
    ]) {
      const authorization = await authorizationHeader(challengeIdOf(challenge), window);
      const result = await settleMppPayment({
        authorizationHeader: authorization,
        challengeHeader: challenge,
        requirements: requirements(),
        secret: SECRET,
        realm: REALM,
        resourceServer,
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.reason).toBe('authorization_window_invalid');
    }
    expect(mock.calls.settle).toBe(0);
  });

  it('facilitator: a verify rejection settles nothing (short validBefore passes local checks, fails the facilitator)', async () => {
    const { mock, resourceServer } = setup();
    const challenge = challengeHeader(nowSec() + 300);
    // The mock facilitator demands validBefore >= now+6; now+3 clears the
    // local window check but not the facilitator's.
    const authorization = await authorizationHeader(challengeIdOf(challenge), {
      validBefore: String(nowSec() + 3),
    });
    const result = await settleMppPayment({
      authorizationHeader: authorization,
      challengeHeader: challenge,
      requirements: requirements(),
      secret: SECRET,
      realm: REALM,
      resourceServer,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('verify_rejected');
    expect(mock.calls.verify).toBe(1);
    expect(mock.calls.settle).toBe(0);
  });
});
