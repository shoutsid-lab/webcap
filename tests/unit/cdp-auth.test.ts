import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildCdpCreateAuthHeaders, generateCdpJwt, parseEd25519PrivateKey } from '../../src/x402/cdp-auth.js';

/**
 * CDP facilitator auth: Ed25519 JWTs per path (verify/settle/supported).
 * Spec source: @coinbase/cdp-sdk 1.55.0 (JWT header/claims + PKCS8/SPKI DER
 * construction). Fixed clock = 1_700_000_000 s.
 *
 * The fixed test secret is the RFC 8032 §A.1 test-vector keypair
 * (seed || public key, 64 bytes) — a self-consistent CDP-format key. An all
 * zero keypair would NOT work here: RFC 8032 scalar clamping forces the
 * 2^255 bit, so a zero seed's public key is not 32 zero bytes, and the
 * public-key-from-trailing-32-bytes verification below would fail.
 */
const API_KEY_ID = 'test-api-key-id';
const SECRET_BYTES = Buffer.concat([
  Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex'), // RFC 8032 §A.1 seed
  Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex'), // its Ed25519 public key
]);
const SECRET_B64 = SECRET_BYTES.toString('base64');
const FIXED_NOW_MS = 1_700_000_000_000; // 1_700_000_000 unix seconds
const CDP_FACILITATOR_URL = 'https://api.cdp.coinbase.com/platform/v2/x402';
const BARE_JWT = /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** The public half of the fixed secret (last 32 bytes) as an SPKI KeyObject. */
function derivedPublicKey(): KeyObject {
  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), SECRET_BYTES.subarray(32)]);
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

function decodeJwt(jwt: string): {
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
  signingInput: string;
  signature: Buffer;
} {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error(`expected 3 jwt parts, got ${parts.length}`);
  const [headerPart = '', claimsPart = '', sigPart = ''] = parts;
  return {
    header: JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as Record<string, unknown>,
    claims: JSON.parse(Buffer.from(claimsPart, 'base64url').toString('utf8')) as Record<string, unknown>,
    signingInput: `${headerPart}.${claimsPart}`,
    signature: Buffer.from(sigPart, 'base64url'),
  };
}

function makeJwt(method: 'POST' | 'GET', path: string): string {
  return generateCdpJwt(
    { apiKeyId: API_KEY_ID, privateKey: parseEd25519PrivateKey(SECRET_B64), method, host: 'api.cdp.coinbase.com', path },
    FIXED_NOW_MS,
  );
}

describe('cdp-auth: parseEd25519PrivateKey', () => {
  it('accepts a valid 64-byte base64 secret (32-byte seed + 32-byte public key)', () => {
    const key = parseEd25519PrivateKey(SECRET_B64);
    expect(key.asymmetricKeyType).toBe('ed25519');
  });

  it('rejects 63 and 65 byte secrets with a message naming CDP_API_KEY_SECRET and Ed25519', () => {
    for (const bytes of [Buffer.alloc(63, 0), Buffer.alloc(65, 0)]) {
      expect(() => parseEd25519PrivateKey(bytes.toString('base64'))).toThrow(/CDP_API_KEY_SECRET/);
      expect(() => parseEd25519PrivateKey(bytes.toString('base64'))).toThrow(/Ed25519/);
    }
  });

  it('rejects invalid base64 with a message naming CDP_API_KEY_SECRET and Ed25519', () => {
    for (const bad of ['!!!not-base64!!!', 'ab', 'AAAA=']) {
      expect(() => parseEd25519PrivateKey(bad)).toThrow(/CDP_API_KEY_SECRET/);
      expect(() => parseEd25519PrivateKey(bad)).toThrow(/Ed25519/);
    }
  });
});

describe('cdp-auth: generateCdpJwt', () => {
  it('emits an EdDSA JWT with the CDP header (alg/kid/typ/nonce)', () => {
    const { header } = decodeJwt(makeJwt('POST', '/platform/v2/x402/verify'));
    expect(header).toEqual({
      alg: 'EdDSA',
      kid: API_KEY_ID,
      typ: 'JWT',
      nonce: expect.stringMatching(/^[0-9a-f]{32}$/),
    });
  });

  it('emits CDP claims (sub/iss/uris/iat/nbf/exp, no aud) bound to method+host+path', () => {
    const { claims } = decodeJwt(makeJwt('POST', '/platform/v2/x402/verify'));
    expect(claims).toEqual({
      sub: API_KEY_ID,
      iss: 'cdp',
      uris: ['POST api.cdp.coinbase.com/platform/v2/x402/verify'],
      iat: 1_700_000_000,
      nbf: 1_700_000_000,
      exp: 1_700_000_120,
    });
    expect('aud' in claims).toBe(false);
  });

  it('binds GET /supported to "GET api.cdp.coinbase.com/.../supported"', () => {
    const { claims } = decodeJwt(makeJwt('GET', '/platform/v2/x402/supported'));
    expect(claims.uris).toEqual(['GET api.cdp.coinbase.com/platform/v2/x402/supported']);
  });

  it('is a valid Ed25519 signature over header.claims, verifiable with the derived public key', () => {
    const jwt = makeJwt('POST', '/platform/v2/x402/verify');
    const { signingInput, signature } = decodeJwt(jwt);
    expect(verify(null, Buffer.from(signingInput, 'utf8'), derivedPublicKey(), signature)).toBe(true);
  });

  it('uses a fresh random nonce per call even with a fixed clock', () => {
    const a = makeJwt('POST', '/platform/v2/x402/verify');
    const b = makeJwt('POST', '/platform/v2/x402/verify');
    expect(decodeJwt(a).header.nonce).not.toBe(decodeJwt(b).header.nonce);
  });
});

describe('cdp-auth: buildCdpCreateAuthHeaders', () => {
  it('returns path-keyed verify/settle/supported (no bazaar) with Bearer JWTs + Correlation-Context', async () => {
    const make = buildCdpCreateAuthHeaders({ id: 'test-id', secret: SECRET_B64 }, CDP_FACILITATOR_URL);
    const result = await make();
    expect(Object.keys(result).sort()).toEqual(['settle', 'supported', 'verify']);

    for (const entry of Object.values(result)) {
      expect(entry?.['Authorization']).toMatch(BARE_JWT);
      expect(entry?.['Correlation-Context'] ?? '').toContain('sdkLanguage=typescript');
    }
  });

  it('binds each path to its real HTTP method (verify/settle POST, supported GET)', async () => {
    const result = await buildCdpCreateAuthHeaders({ id: 'test-id', secret: SECRET_B64 }, CDP_FACILITATOR_URL)();
    expect(decodeJwt((result.verify?.['Authorization'] ?? '').slice('Bearer '.length)).claims.uris).toEqual([
      'POST api.cdp.coinbase.com/platform/v2/x402/verify',
    ]);
    expect(decodeJwt((result.settle?.['Authorization'] ?? '').slice('Bearer '.length)).claims.uris).toEqual([
      'POST api.cdp.coinbase.com/platform/v2/x402/settle',
    ]);
    expect(decodeJwt((result.supported?.['Authorization'] ?? '').slice('Bearer '.length)).claims.uris).toEqual([
      'GET api.cdp.coinbase.com/platform/v2/x402/supported',
    ]);
  });

  it('signs every path with a JWT that verifies against the derived public key', async () => {
    const result = await buildCdpCreateAuthHeaders({ id: 'test-id', secret: SECRET_B64 }, CDP_FACILITATOR_URL)();
    for (const [path, entry] of Object.entries(result)) {
      const { signingInput, signature } = decodeJwt((entry?.['Authorization'] ?? '').slice('Bearer '.length));
      expect(verify(null, Buffer.from(signingInput, 'utf8'), derivedPublicKey(), signature), path).toBe(true);
    }
  });

  it('mints a fresh JWT per call (not a cached token)', async () => {
    const make = buildCdpCreateAuthHeaders({ id: 'test-id', secret: SECRET_B64 }, CDP_FACILITATOR_URL);
    const first = (await make()).verify?.['Authorization'];
    const second = (await make()).verify?.['Authorization'];
    expect(first).toBeDefined();
    expect(first).not.toBe(second);
  });
});
