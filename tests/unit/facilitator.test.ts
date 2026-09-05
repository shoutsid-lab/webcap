import { createPublicKey, verify } from 'node:crypto';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { describe, expect, it } from 'vitest';
import { loadConfig, type WebcapConfig } from '../../src/config.js';
import { buildX402Facilitator } from '../../src/x402/facilitator.js';

/**
 * buildX402Facilitator: config-driven construction of the x402 facilitator
 * client with OPTIONAL CDP facilitator auth. No network calls: only the
 * public createAuthHeaders(path) method is exercised (it never fetches).
 */
// RFC 8032 §A.1 test-vector keypair (seed || public key) — see cdp-auth.test.ts
// for why this must be a self-consistent keypair rather than 64 zero bytes.
const SECRET_BYTES = Buffer.concat([
  Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex'),
  Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex'),
]);
const SECRET_B64 = SECRET_BYTES.toString('base64');
const CDP_ID = 'test-cdp-key-id';
const CDP_URL = 'https://api.cdp.coinbase.com/platform/v2/x402';
const BARE_JWT = /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** SPKI KeyObject for the public half of the fixed secret (last 32 bytes). */
function derivedPublicKey() {
  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), SECRET_BYTES.subarray(32)]);
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

function jwtFromAuthorization(authorization: string): { signingInput: string; signature: Buffer; uris: unknown } {
  const token = authorization.slice('Bearer '.length);
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error(`expected 3 jwt parts, got ${parts.length}`);
  const [headerPart = '', claimsPart = '', sigPart = ''] = parts;
  return {
    signingInput: `${headerPart}.${claimsPart}`,
    signature: Buffer.from(sigPart, 'base64url'),
    uris: (JSON.parse(Buffer.from(claimsPart, 'base64url').toString('utf8')) as { uris?: unknown }).uris,
  };
}

function config(overrides: Record<string, string> = {}): WebcapConfig {
  return loadConfig({
    WEBCAP_CHAIN: 'base-sepolia',
    WEBCAP_PUBLIC_BASE_URL: 'https://example.test',
    ...overrides,
  });
}

describe('x402: buildX402Facilitator', () => {
  it('returns undefined when x402 is disabled (local chain)', () => {
    const cfg = config({
      WEBCAP_CHAIN: 'local',
      LOCAL_USDC_CONTRACT: `0x${'11'.repeat(20)}`,
    });
    expect(cfg.x402Network).toBeUndefined();
    expect(buildX402Facilitator(cfg)).toBeUndefined();
  });

  it('enabled + no CDP keys -> plain HTTPFacilitatorClient with no auth headers (byte-identical to today)', async () => {
    const cfg = config({ X402_FACILITATOR_URL: 'https://x402.org/facilitator' });
    const client = buildX402Facilitator(cfg);
    expect(client).toBeInstanceOf(HTTPFacilitatorClient);
    // Confirmed against @x402/core source: no createAuthHeaders config -> { headers: {} }.
    await expect(client!.createAuthHeaders('verify')).resolves.toEqual({ headers: {} });
    await expect(client!.createAuthHeaders('settle')).resolves.toEqual({ headers: {} });
  });

  it('enabled + CDP keys + CDP host -> createAuthHeaders resolves to signed CDP JWT headers', async () => {
    const cfg = config({
      X402_FACILITATOR_URL: CDP_URL,
      CDP_API_KEY_ID: CDP_ID,
      CDP_API_KEY_SECRET: SECRET_B64,
    });
    const client = buildX402Facilitator(cfg);
    expect(client).toBeInstanceOf(HTTPFacilitatorClient);

    const { headers } = await client!.createAuthHeaders('verify');
    expect(headers['Authorization']).toMatch(BARE_JWT);
    expect(headers['Correlation-Context'] ?? '').toContain('sdkLanguage=typescript');

    const { signingInput, signature, uris } = jwtFromAuthorization(headers['Authorization']!);
    expect(uris).toEqual(['POST api.cdp.coinbase.com/platform/v2/x402/verify']);
    expect(verify(null, Buffer.from(signingInput, 'utf8'), derivedPublicKey(), signature)).toBe(true);

    const settle = await client!.createAuthHeaders('settle');
    expect(jwtFromAuthorization(settle.headers['Authorization']!).uris).toEqual([
      'POST api.cdp.coinbase.com/platform/v2/x402/settle',
    ]);
    const supported = await client!.createAuthHeaders('supported');
    expect(jwtFromAuthorization(supported.headers['Authorization']!).uris).toEqual([
      'GET api.cdp.coinbase.com/platform/v2/x402/supported',
    ]);
  });

  it('enabled + CDP keys + non-CDP host -> throws (CDP JWTs are bound to the CDP host)', () => {
    const cfg = config({
      X402_FACILITATOR_URL: 'https://x402.org/facilitator',
      CDP_API_KEY_ID: CDP_ID,
      CDP_API_KEY_SECRET: SECRET_B64,
    });
    expect(() => buildX402Facilitator(cfg)).toThrow(/api\.cdp\.coinbase\.com/);
  });
});
