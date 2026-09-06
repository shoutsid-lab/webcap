/**
 * x402scan origin registration via Sign-In-With-X (SIWX).
 *
 * Auth-only EIP-191 signature with the webcap MERCHANT wallet (no funds move,
 * no account created). Idempotent: re-running refreshes the listing. Used by
 * bin/webcap-keepalive.sh only when the origin has dropped off x402scan.
 *
 * Usage (from the repo root):
 *   npx tsx scripts/x402scan-register.ts
 *
 * Env (all optional — .env is read as fallback):
 *   X402SCAN_ORIGIN             service origin (default: WEBCAP_PUBLIC_BASE_URL)
 *   USDC_MERCHANT_PRIVATE_KEY   merchant (payTo) private key
 *   WEBCAP_MERCHANT_ADDRESS     expected address (guard against a wrong key)
 */
import { readFileSync } from 'node:fs';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import {
  createSIWxPayload,
  encodeSIWxHeader,
  type CompleteSIWxInfo,
  type SIWxExtensionInfo,
  type SupportedChain,
} from '@x402/extensions/sign-in-with-x';
import { privateKeyToAccount } from 'viem/accounts';

const REG_URL = 'https://www.x402scan.com/api/x402/registry/register-origin';
const TIMEOUT_MS = 30_000;

function envLine(name: string): string | undefined {
  let raw: string;
  try {
    raw = readFileSync('.env', 'utf8');
  } catch {
    return undefined;
  }
  const line = raw.split('\n').find((l) => l.startsWith(`${name}=`));
  return line === undefined ? undefined : line.split('=').slice(1).join('=').trim();
}

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const origin = (process.env.X402SCAN_ORIGIN ?? envLine('WEBCAP_PUBLIC_BASE_URL') ?? '').replace(/\/+$/, '');
const keyRaw = (process.env.USDC_MERCHANT_PRIVATE_KEY ?? envLine('USDC_MERCHANT_PRIVATE_KEY') ?? '').trim();
const expected = (envLine('WEBCAP_MERCHANT_ADDRESS') ?? '').trim();
if (origin === '') {
  fail('origin unknown — set X402SCAN_ORIGIN or WEBCAP_PUBLIC_BASE_URL in .env');
}
if (keyRaw === '' || !/^0x[0-9a-fA-F]{64}$/.test(keyRaw)) {
  fail('USDC_MERCHANT_PRIVATE_KEY missing or not 0x-prefixed 32-byte hex (env or .env)');
}

const account = privateKeyToAccount(keyRaw as `0x${string}`);
if (expected !== '' && account.address.toLowerCase() !== expected.toLowerCase()) {
  fail('merchant key derives an unexpected address — refusing to sign');
}
console.log(`signer: ${account.address} (origin ${origin})`);

// Step 1: fetch the SIWX challenge (402 with PAYMENT-REQUIRED carrying sign-in-with-x).
const first = await fetch(REG_URL, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ origin }),
  signal: AbortSignal.timeout(TIMEOUT_MS),
});
if (first.status !== 402) {
  fail(`expected 402 SIWX challenge, got ${first.status}`);
}
const rawHeader = first.headers.get('payment-required');
if (rawHeader === null) {
  fail('no payment-required header on SIWX challenge');
}
const challenge = decodePaymentRequiredHeader(rawHeader);

// Boundary cast: x402 core types extensions as Record<string, unknown>; the
// sign-in-with-x extension shape is fixed by the x402scan challenge.
const siwx = challenge.extensions?.['sign-in-with-x'] as
  | { info: SIWxExtensionInfo; supportedChains?: SupportedChain[] }
  | undefined;
if (siwx?.info === undefined) {
  fail('challenge has no sign-in-with-x info');
}

// Step 2: build + sign the SIWE message (EIP-191) with the merchant key.
// viem's PrivateKeyAccount structurally satisfies EVMSigner (signMessage + address).
const chain: SupportedChain = siwx.supportedChains?.[0] ?? {
  chainId: 'eip155:8453',
  type: 'eip191',
};
const complete: CompleteSIWxInfo = {
  ...siwx.info,
  chainId: chain.chainId,
  type: chain.type,
  signatureScheme: chain.signatureScheme,
};
const payload = await createSIWxPayload(complete, account, REG_URL);
const siwxHeader = encodeSIWxHeader(payload);

// Step 3: retry with the signature header.
const second = await fetch(REG_URL, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'SIGN-IN-WITH-X': siwxHeader },
  body: JSON.stringify({ origin }),
  signal: AbortSignal.timeout(TIMEOUT_MS),
});
const text = await second.text();
if (second.status === 404) {
  fail('no_discovery — is /openapi.json served at the origin?');
}
if (second.status !== 200) {
  fail(`status=${second.status} body=${text.slice(0, 300)}`);
}
type RegisterResult = {
  success?: boolean;
  registered?: number;
  total?: number;
  source?: string;
};
const parsed = JSON.parse(text) as RegisterResult;
if (parsed.success !== true) {
  fail(`x402scan rejected registration: ${text.slice(0, 300)}`);
}
console.log(
  `PASS: x402scan origin registered — success=${parsed.success} registered=${parsed.registered} total=${parsed.total} source=${parsed.source}`,
);
