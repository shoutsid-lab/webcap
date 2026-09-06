/**
 * MPP credential settlement: turn an `Authorization: Payment credential="…"`
 * header into a standard x402 v2 exact/evm payment payload and run it through
 * the SAME x402ResourceServer verify+settle path as x402.
 *
 * The credential is a b64url JSON EIP-3009 authorization
 * ({from,to,value,validAfter,validBefore,nonce,v,r,s}) bound to the MPP
 * challenge id. Verification order is deliberate and cheap-first:
 *
 *   1. extract the credential (absent -> missing, falls through to x402 402)
 *   2. parse the challenge, recompute the HMAC id, check challenge expiry
 *      (BEFORE touching crypto)
 *   3. bind credential.challengeId to the challenge id
 *   4. bind credential value/to to the challenged terms (requirements +
 *      the HMAC-protected request body must all agree)
 *   5. check the EIP-3009 time window
 *   6. recover the signer with ethers verifyTypedData against the USDC domain
 *   7. convert to the x402 v2 exact/evm payload (with the `accepted`
 *      requirements echo) and reuse resourceServer.verifyPayment/settlePayment
 *
 * No new settlement infra, no gas payments, no token list: everything after
 * step 6 is the existing facilitator path. Any failure returns ok:false with
 * a 402-mappable reason and NEVER settles.
 *
 * SEAM for the header hook (sibling agent owns src/mpp/plugin.ts): call
 * settleMppPayment with the request's Authorization header, the challenge
 * header issued for these terms, the route's PaymentRequirements, the
 * MppConfig secret/realm, and the shared x402ResourceServer. On
 * `{ok:false, reason:'missing_authorization'}` fall through to the x402 402
 * unchanged; on any other failure answer 402; on ok:true continue with
 * `result.paymentPayload` attached as the payer context (x402Payer-compatible).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { Signature, verifyTypedData } from 'ethers';
import type { x402ResourceServer } from '@x402/core/server';
import type { PaymentPayload, PaymentRequirements, SettleResponse } from '@x402/core/types';

import { parseWwwAuthenticate } from './challenge.js';

export type MppSettleFailureReason =
  | 'missing_authorization'
  | 'malformed_authorization'
  | 'malformed_credential'
  | 'malformed_challenge'
  | 'challenge_id_mismatch'
  | 'challenge_expired'
  | 'amount_mismatch'
  | 'recipient_mismatch'
  | 'authorization_window_invalid'
  | 'invalid_signature'
  | 'verify_rejected'
  | 'settle_failed';

export interface MppSettleParams {
  /** Raw `Authorization` header value; undefined/empty means "no MPP credential". */
  readonly authorizationHeader: string | undefined;
  /** The exact `Payment ...` challenge header issued for these terms. */
  readonly challengeHeader: string;
  /** The challenged x402 terms (amount/payTo/asset/network + EIP-712 extra). */
  readonly requirements: PaymentRequirements;
  /** Key material (compatible with MppConfig['secret']); never logged. */
  readonly secret: Buffer;
  /** Scheme+host origin (compatible with MppConfig['realm']). */
  readonly realm: string;
  /** The shared resource server (already registered with ExactEvmScheme). */
  readonly resourceServer: x402ResourceServer;
}

export type MppSettleResult =
  | {
      readonly ok: true;
      readonly payer: string;
      readonly settlement: SettleResponse;
      /** Standard x402 v2 payload; attach as payer context (x402Payer reads it). */
      readonly paymentPayload: PaymentPayload;
    }
  | { readonly ok: false; readonly reason: MppSettleFailureReason; readonly detail?: string };

interface MppCredential {
  readonly from: string;
  readonly to: string;
  readonly value: string;
  readonly validAfter: string;
  readonly validBefore: string;
  readonly nonce: string;
  readonly v: number;
  readonly r: string;
  readonly s: string;
  readonly challengeId: string;
}

const AUTHORIZATION_PATTERN = /^Payment\s+credential="([^"]+)"$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL_PATTERN = /^[0-9]+$/;

const AUTHORIZATION_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

function fail(reason: MppSettleFailureReason, detail?: string): MppSettleResult {
  return { ok: false, reason, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Atomic-unit decimal string rendered as 6dp human USD (mirrors challenge.ts usdAmount). */
function usdAmount(units: string): string {
  const raw = BigInt(units);
  const whole = raw / 1_000_000n;
  const frac = (raw % 1_000_000n).toString().padStart(6, '0');
  return `${whole.toString()}.${frac}`;
}

function hmacMatches(secret: Buffer, a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseCredential(raw: string): MppCredential | undefined {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(decoded)) return undefined;
  const { from, to, value, validAfter, validBefore, nonce, v, r, s, challengeId } = decoded;
  if (
    typeof from !== 'string' ||
    typeof to !== 'string' ||
    typeof value !== 'string' ||
    typeof validAfter !== 'string' ||
    typeof validBefore !== 'string' ||
    typeof nonce !== 'string' ||
    typeof r !== 'string' ||
    typeof s !== 'string' ||
    typeof challengeId !== 'string' ||
    typeof v !== 'number' ||
    !ADDRESS_PATTERN.test(from) ||
    !ADDRESS_PATTERN.test(to) ||
    !DECIMAL_PATTERN.test(value) ||
    !DECIMAL_PATTERN.test(validAfter) ||
    !DECIMAL_PATTERN.test(validBefore) ||
    !BYTES32_PATTERN.test(nonce) ||
    !Number.isInteger(v) ||
    challengeId === ''
  ) {
    return undefined;
  }
  return { from, to, value, validAfter, validBefore, nonce, v, r, s, challengeId };
}

function chainIdOf(network: string): number | undefined {
  const match = /^eip155:([0-9]+)$/.exec(network);
  if (match?.[1] === undefined) return undefined;
  const chainId = Number(match[1]);
  return Number.isSafeInteger(chainId) ? chainId : undefined;
}

/**
 * Settle an MPP credential through the existing x402 verify+settle path.
 * Pure orchestration over the shared resourceServer; never throws for
 * credential/challenge problems (those are ok:false reasons). Transport or
 * coding errors from the facilitator surface as verify_rejected/settle_failed.
 */
export async function settleMppPayment(params: MppSettleParams): Promise<MppSettleResult> {
  const { authorizationHeader, challengeHeader, requirements, secret, realm, resourceServer } = params;

  // 1. Absent Authorization falls through to the x402 402 unchanged.
  if (authorizationHeader === undefined || authorizationHeader.trim() === '') {
    return fail('missing_authorization');
  }
  const authMatch = AUTHORIZATION_PATTERN.exec(authorizationHeader.trim());
  if (authMatch?.[1] === undefined || authMatch[1] === '') return fail('malformed_authorization');
  const credential = parseCredential(authMatch[1]);
  if (credential === undefined) return fail('malformed_credential');

  // 2. Challenge parse + HMAC id recompute + expiry BEFORE any crypto.
  let parsed: { id: string; realm: string; request: string; expires: string };
  try {
    parsed = parseWwwAuthenticate(challengeHeader);
  } catch {
    return fail('malformed_challenge');
  }
  const expectedPayload = `${realm}|evm|charge|${parsed.request}|${parsed.expires}||`;
  const expectedId = createHmac('sha256', secret).update(expectedPayload, 'utf8').digest('base64url');
  if (parsed.realm !== realm || !hmacMatches(secret, parsed.id, expectedId)) {
    return fail('challenge_id_mismatch');
  }
  const expiresMs = Date.parse(parsed.expires);
  if (!Number.isFinite(expiresMs)) return fail('malformed_challenge');
  if (expiresMs <= Date.now()) return fail('challenge_expired');

  // 3. Credential must be bound to this exact challenge id.
  if (credential.challengeId !== parsed.id) return fail('challenge_id_mismatch');

  // 4. The HMAC-protected request, the requirements, and the credential terms
  //    must all agree (prevents swapping a valid auth across prices/recipients).
  let requestBody: unknown;
  try {
    requestBody = JSON.parse(Buffer.from(parsed.request, 'base64url').toString('utf8')) as unknown;
  } catch {
    return fail('malformed_challenge');
  }
  if (!isRecord(requestBody) || typeof requestBody['amount'] !== 'string' || typeof requestBody['recipient'] !== 'string') {
    return fail('malformed_challenge');
  }
  let requirementsAmount: string;
  try {
    requirementsAmount = usdAmount(requirements.amount);
  } catch {
    return fail('amount_mismatch');
  }
  if (requirementsAmount !== requestBody['amount']) return fail('amount_mismatch');
  if (typeof requirements.payTo !== 'string' || requirements.payTo.toLowerCase() !== requestBody['recipient'].toLowerCase()) {
    return fail('recipient_mismatch');
  }
  if (credential.value !== requirements.amount) return fail('amount_mismatch');
  if (credential.to.toLowerCase() !== requirements.payTo.toLowerCase()) return fail('recipient_mismatch');

  // 5. EIP-3009 time window (strict server-clock check, no skew grace: the
  //    signer mints fresh windows per challenge, so tolerance only widens replay).
  const nowSec = Math.floor(Date.now() / 1000);
  const validAfter = BigInt(credential.validAfter);
  const validBefore = BigInt(credential.validBefore);
  if (!(validAfter <= validBefore && validAfter <= BigInt(nowSec) && validBefore > BigInt(nowSec))) {
    return fail('authorization_window_invalid');
  }

  // 6. Signature recovery against the challenged USDC domain.
  const chainId = chainIdOf(requirements.network);
  const extra = requirements.extra;
  const domainName = isRecord(extra) && typeof extra['name'] === 'string' ? extra['name'] : undefined;
  const domainVersion = isRecord(extra) && typeof extra['version'] === 'string' ? extra['version'] : undefined;
  if (chainId === undefined || domainName === undefined || domainVersion === undefined) {
    return fail('invalid_signature', 'unresolvable EIP-712 domain');
  }
  let signatureHex: string;
  try {
    signatureHex = Signature.from({ r: credential.r, s: credential.s, v: credential.v }).serialized;
  } catch {
    return fail('invalid_signature');
  }
  let recovered: string;
  try {
    recovered = verifyTypedData(
      { name: domainName, version: domainVersion, chainId, verifyingContract: requirements.asset },
      AUTHORIZATION_TYPES,
      {
        from: credential.from,
        to: credential.to,
        value: BigInt(credential.value),
        validAfter,
        validBefore,
        nonce: credential.nonce,
      },
      signatureHex,
    );
  } catch {
    return fail('invalid_signature');
  }
  if (recovered.toLowerCase() !== credential.from.toLowerCase()) return fail('invalid_signature');

  // 7. Convert to the standard x402 v2 exact/evm payload (with the `accepted`
  //    requirements echo the PaymentPayload shape requires) and reuse the
  //    existing verify+settle path — no new settlement infra.
  const paymentPayload: PaymentPayload = {
    x402Version: 2,
    accepted: requirements,
    payload: {
      authorization: {
        from: credential.from,
        to: credential.to,
        value: credential.value,
        validAfter: credential.validAfter,
        validBefore: credential.validBefore,
        nonce: credential.nonce,
      },
      signature: signatureHex,
    },
  };
  let verified: { isValid: boolean; invalidReason?: string; payer?: string };
  try {
    verified = await resourceServer.verifyPayment(paymentPayload, requirements);
  } catch (error) {
    return fail('verify_rejected', error instanceof Error ? error.message : String(error));
  }
  if (!verified.isValid) return fail('verify_rejected', verified.invalidReason);
  let settlement: SettleResponse;
  try {
    settlement = await resourceServer.settlePayment(paymentPayload, requirements);
  } catch (error) {
    return fail('settle_failed', error instanceof Error ? error.message : String(error));
  }
  if (!settlement.success) return fail('settle_failed');
  return { ok: true, payer: verified.payer ?? credential.from, settlement, paymentPayload };
}
