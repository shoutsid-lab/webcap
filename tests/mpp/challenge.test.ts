import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildWwwAuthenticate, parseWwwAuthenticate } from '../../src/mpp/challenge.js';

// Fixed vectors: every value below is pinned so a behavioral drift fails loudly.
const SECRET_HEX = 'ab'.repeat(32);
const SECRET = Buffer.from(SECRET_HEX, 'hex');
const REALM = 'https://x.ngrok-free.dev';
const RECIPIENT = '0xB25572D7317eb98EBb39c45Da40eAAEA2A56c25e';
const EXPIRES_AT_SEC = 1767225600; // 2026-01-01T00:00:00.000Z
const EXPIRES_ISO = '2026-01-01T00:00:00.000Z';

const EXPECTED_JCS =
  '{"amount":"0.001000","currency":"USD","methodDetails":{"chainId":8453,"credentialTypes":["authorization"],"decimals":6},"recipient":"0xB25572D7317eb98EBb39c45Da40eAAEA2A56c25e"}';
const EXPECTED_REQUEST =
  'eyJhbW91bnQiOiIwLjAwMTAwMCIsImN1cnJlbmN5IjoiVVNEIiwibWV0aG9kRGV0YWlscyI6eyJjaGFpbklkIjo4NDUzLCJjcmVkZW50aWFsVHlwZXMiOlsiYXV0aG9yaXphdGlvbiJdLCJkZWNpbWFscyI6Nn0sInJlY2lwaWVudCI6IjB4QjI1NTcyRDczMTdlYjk4RUJiMzljNDVEYTQwZUFBRUEyQTU2YzI1ZSJ9';
const EXPECTED_ID = 'SgcGajoJ_tRL9iondo6RqCeojV40KYQRH3-aXyPxwQQ';
const EXPECTED_HEADER = `Payment id="${EXPECTED_ID}",realm="${REALM}",method="evm",intent="charge",request="${EXPECTED_REQUEST}",expires="${EXPIRES_ISO}"`;

const BASE_PARAMS = {
  amountUsdcUnits: 1000,
  recipient: RECIPIENT,
  realm: REALM,
  method: 'evm' as const,
  intent: 'charge' as const,
  secret: SECRET,
  expiresAtSec: EXPIRES_AT_SEC,
  chainId: 8453,
};

describe('mpp challenge: buildWwwAuthenticate fixed vector', () => {
  it('returns the exact pinned header string', () => {
    expect(buildWwwAuthenticate(BASE_PARAMS)).toBe(EXPECTED_HEADER);
  });

  it('recomputes id independently via node:crypto HMAC-SHA256', () => {
    const header = buildWwwAuthenticate(BASE_PARAMS);
    const request = Buffer.from(EXPECTED_JCS, 'utf8').toString('base64url');
    expect(request).toBe(EXPECTED_REQUEST);
    const payload = `${REALM}|evm|charge|${request}|${EXPIRES_ISO}||`;
    const id = createHmac('sha256', SECRET).update(payload, 'utf8').digest('base64url');
    expect(id).toBe(EXPECTED_ID);
    expect(header).toContain(`id="${id}"`);
  });

  it('yields identical request when JCS keys are shuffled (canonical sorted keys, no whitespace)', () => {
    const header = buildWwwAuthenticate(BASE_PARAMS);
    // Same logical payload, declaration order shuffled: canonicalization must erase the difference.
    const shuffled = {
      recipient: RECIPIENT,
      methodDetails: { decimals: 6, credentialTypes: ['authorization'], chainId: 8453 },
      currency: 'USD',
      amount: '0.001000',
    };
    const parsed = parseWwwAuthenticate(header);
    const fromShuffled = Buffer.from(JSON.stringify(shuffled), 'utf8').toString('base64url');
    // Naive JSON.stringify preserves insertion order, so it must differ from canonical...
    expect(fromShuffled).not.toBe(parsed.request);
    // ...while the canonical re-encoding of the shuffled object matches exactly.
    const canonicalOfShuffled = Buffer.from(
      JSON.stringify({
        amount: shuffled.amount,
        currency: shuffled.currency,
        methodDetails: {
          chainId: 8453,
          credentialTypes: ['authorization'],
          decimals: 6,
        },
        recipient: shuffled.recipient,
      }),
      'utf8',
    ).toString('base64url');
    expect(canonicalOfShuffled).toBe(parsed.request);
    expect(parsed.request).toBe(EXPECTED_REQUEST);
  });

  it('formats amount as 6dp human USD from atomic units (1000 -> 0.001000)', () => {
    const parsed = parseWwwAuthenticate(buildWwwAuthenticate(BASE_PARAMS));
    const body = JSON.parse(Buffer.from(parsed.request, 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(body['amount']).toBe('0.001000');
    expect(body['currency']).toBe('USD');
  });
});

describe('mpp challenge: parseWwwAuthenticate round-trip', () => {
  it('round-trips the built header field-for-field', () => {
    const header = buildWwwAuthenticate(BASE_PARAMS);
    const parsed = parseWwwAuthenticate(header);
    expect(parsed).toEqual({
      id: EXPECTED_ID,
      realm: REALM,
      method: 'evm',
      intent: 'charge',
      request: EXPECTED_REQUEST,
      expires: EXPIRES_ISO,
    });
  });

  it('round-trips a dynamic topup-style amount (no pinned literal)', () => {
    const header = buildWwwAuthenticate({ ...BASE_PARAMS, amountUsdcUnits: 10000 });
    const parsed = parseWwwAuthenticate(header);
    const body = JSON.parse(Buffer.from(parsed.request, 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(body['amount']).toBe('0.010000');
    expect(parseWwwAuthenticate(header)).toEqual(parsed);
  });

  it('throws on a malformed header', () => {
    expect(() => parseWwwAuthenticate('Bearer abc')).toThrow();
    expect(() => parseWwwAuthenticate('Payment id="x",realm="y"')).toThrow();
  });
});
