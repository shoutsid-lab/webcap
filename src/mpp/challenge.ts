/**
 * MPP 402 challenge builder/parser: the `Payment` WWW-Authenticate header.
 *
 * Pure functions over node:crypto only (no new deps). The builder takes the
 * atomic USDC price as input (per-route prices live in the x402 layer; this
 * module never imports WatchRepo) and binds it into a canonical JCS payload
 * whose HMAC id ties realm/method/intent/request/expiry together.
 *
 * Amount formatting mirrors the `usdAmount` pattern in
 * src/server/openapi/paths-x402.ts (atomic units / USDC_SCALE, fixed 6dp);
 * expiry mirrors `maxTimeoutSeconds` semantics in src/server/x402/routes.ts
 * (an absolute epoch-seconds instant rendered as RFC3339/ISO UTC).
 */
import { createHmac } from 'node:crypto';

import { USDC_SCALE } from '../config/pricing.js';

export const MPP_CHALLENGE_METHOD = 'evm';
export const MPP_CHALLENGE_INTENT = 'charge';
export const MPP_CHALLENGE_CURRENCY = 'USD';
export const MPP_CHALLENGE_DECIMALS = 6;
export const MPP_CHALLENGE_CREDENTIAL_TYPES: readonly string[] = ['authorization'];

export interface BuildWwwAuthenticateParams {
  /** Atomic USDC units (1 USDC = USDC_SCALE units); rendered as 6dp USD. */
  readonly amountUsdcUnits: number;
  /** Pay-to address (the recipient of the charge). */
  readonly recipient: string;
  /** Scheme+host origin the session is bound to (compatible with MppConfig['realm']). */
  readonly realm: string;
  readonly method: 'evm';
  readonly intent: 'charge';
  /** Key material (compatible with MppConfig['secret']); never logged. */
  readonly secret: Buffer;
  /** Absolute expiry as epoch seconds (mirrors maxTimeoutSeconds semantics). */
  readonly expiresAtSec: number;
  /** Caller-supplied chain context (compatible with MppConfig['chainId']). */
  readonly chainId: number;
  /** Reserved binding slots; empty string when absent. */
  readonly digest?: string;
  readonly opaque?: string;
}

export interface ParsedWwwAuthenticate {
  readonly id: string;
  readonly realm: string;
  readonly method: 'evm';
  readonly intent: 'charge';
  readonly request: string;
  readonly expires: string;
}

/** 6-decimal human USD string from atomic USDC units (1000 -> '0.001000'). */
function usdAmount(units: number): string {
  return (units / USDC_SCALE).toFixed(6);
}

function b64urlOfUtf8(raw: string): string {
  return Buffer.from(raw, 'utf8').toString('base64url');
}

/**
 * Canonical JCS over {amount, currency, recipient, methodDetails}: top-level
 * keys sorted, nested methodDetails keys sorted, no whitespace. The object is
 * constructed in sorted-key order and holds only string/number/array scalars,
 * so JSON.stringify emits the canonical form directly.
 */
function canonicalRequestJson(amountUsdcUnits: number, recipient: string, chainId: number): string {
  return (
    `{"amount":${JSON.stringify(usdAmount(amountUsdcUnits))}` +
    `,"currency":${JSON.stringify(MPP_CHALLENGE_CURRENCY)}` +
    `,"methodDetails":{"chainId":${chainId}` +
    `,"credentialTypes":${JSON.stringify([...MPP_CHALLENGE_CREDENTIAL_TYPES])}` +
    `,"decimals":${MPP_CHALLENGE_DECIMALS}}` +
    `,"recipient":${JSON.stringify(recipient)}}`
  );
}

function challengeId(
  secret: Buffer,
  realm: string,
  method: string,
  intent: string,
  request: string,
  expires: string,
  digest: string,
  opaque: string,
): string {
  const payload = `${realm}|${method}|${intent}|${request}|${expires}|${digest}|${opaque}`;
  return createHmac('sha256', secret).update(payload, 'utf8').digest('base64url');
}

/**
 * Build the exact `Payment id="…",realm="…",method="evm",intent="charge",
 * request="…",expires="…"` challenge header.
 */
export function buildWwwAuthenticate(params: BuildWwwAuthenticateParams): string {
  const digest = params.digest ?? '';
  const opaque = params.opaque ?? '';
  const request = b64urlOfUtf8(canonicalRequestJson(params.amountUsdcUnits, params.recipient, params.chainId));
  // Absolute epoch-seconds instant rendered as RFC3339/ISO UTC.
  const expires = new Date(params.expiresAtSec * 1000).toISOString();
  const id = challengeId(params.secret, params.realm, params.method, params.intent, request, expires, digest, opaque);
  return (
    `Payment id="${id}",realm="${params.realm}",method="${params.method}",` +
    `intent="${params.intent}",request="${request}",expires="${expires}"`
  );
}

const HEADER_PATTERN =
  /^Payment id="([^"]+)",realm="([^"]+)",method="([^"]+)",intent="([^"]+)",request="([^"]+)",expires="([^"]+)"$/;

/** Parse a `Payment ...` challenge header back into its fields; throws on malformed input. */
export function parseWwwAuthenticate(header: string): ParsedWwwAuthenticate {
  const match = HEADER_PATTERN.exec(header.trim());
  if (match === undefined || match === null) throw new Error('malformed MPP Payment challenge header');
  const [, id, realm, method, intent, request, expires] = match;
  if (
    id === undefined ||
    realm === undefined ||
    method === undefined ||
    intent === undefined ||
    request === undefined ||
    expires === undefined
  ) {
    throw new Error('malformed MPP Payment challenge header');
  }
  if (method !== MPP_CHALLENGE_METHOD) throw new Error(`unsupported MPP challenge method: ${method}`);
  if (intent !== MPP_CHALLENGE_INTENT) throw new Error(`unsupported MPP challenge intent: ${intent}`);
  return { id, realm, method, intent, request, expires };
}
