import { describe, expect, it } from 'vitest';
import { loadMppConfig, parseMppSecret, realmOf } from '../../src/mpp/config.js';

const PUBLIC_URL = 'https://x.ngrok-free.dev';
const RAW_SECRET = 'this-is-a-raw-utf8-passphrase-32b!'; // 35 bytes as UTF-8
const HEX_SECRET = 'ab'.repeat(32); // 64 hex chars -> 32 bytes
const HEX_0X_SECRET = `0x${'cd'.repeat(32)}`;

describe('mpp config: disabled by default (x402-only)', () => {
  it('is disabled when MPP_SECRET_KEY is unset', () => {
    const cfg = loadMppConfig({}, PUBLIC_URL);
    expect(cfg.enabled).toBe(false);
    expect(cfg.secret.length).toBe(0);
    expect(cfg.realm).toBe('x.ngrok-free.dev');
    expect(cfg.chainId).toBe(8453);
  });

  it('is disabled when MPP_SECRET_KEY is empty or whitespace-only', () => {
    for (const bad of ['', '   ']) {
      const cfg = loadMppConfig({ MPP_SECRET_KEY: bad }, PUBLIC_URL);
      expect(cfg.enabled).toBe(false);
      expect(cfg.secret.length).toBe(0);
    }
  });
});

describe('mpp config: parseMppSecret', () => {
  it('accepts a raw UTF-8 passphrase of >=32 bytes', () => {
    expect(Buffer.byteLength(RAW_SECRET, 'utf8')).toBeGreaterThanOrEqual(32);
    const secret = parseMppSecret(RAW_SECRET);
    expect(secret).toBeInstanceOf(Buffer);
    expect(secret.equals(Buffer.from(RAW_SECRET, 'utf8'))).toBe(true);
  });

  it('accepts a 64-char hex secret as 32 decoded bytes', () => {
    const secret = parseMppSecret(HEX_SECRET);
    expect(secret.equals(Buffer.from(HEX_SECRET, 'hex'))).toBe(true);
    expect(secret.length).toBe(32);
  });

  it('accepts a 0x-prefixed hex secret as decoded bytes', () => {
    const secret = parseMppSecret(HEX_0X_SECRET);
    expect(secret.equals(Buffer.from(HEX_0X_SECRET.slice(2), 'hex'))).toBe(true);
    expect(secret.length).toBe(32);
  });

  it('throws when the decoded secret is shorter than 32 bytes', () => {
    expect(() => parseMppSecret('too-short')).toThrow(/MPP_SECRET_KEY/);
    expect(() => parseMppSecret('ab'.repeat(8))).toThrow(/MPP_SECRET_KEY/);
    expect(() => parseMppSecret(`0x${'ab'.repeat(8)}`)).toThrow(/MPP_SECRET_KEY/);
  });

  it('throws on a 0x-prefixed value that is not valid hex', () => {
    expect(() => parseMppSecret('0xnot-hex!!')).toThrow(/MPP_SECRET_KEY/);
  });
});

describe('mpp config: realmOf', () => {
  // mppscan rejects scheme-qualified realms (REALM_MISMATCH): realm must be
  // the bare host of the origin the agent calls.
  it('returns the bare host only, stripping scheme and path', () => {
    expect(realmOf('https://x.ngrok-free.dev/v1/x')).toBe('x.ngrok-free.dev');
  });

  it('keeps an explicit port on the host', () => {
    expect(realmOf('http://localhost:8080/v1/artifacts/abc')).toBe('localhost:8080');
  });

  it('throws on an invalid URL', () => {
    expect(() => realmOf('not-a-url')).toThrow();
  });
});

describe('mpp config: loadMppConfig enabled path', () => {
  it('enables MPP with realm + secret when MPP_SECRET_KEY is set', () => {
    const cfg = loadMppConfig({ MPP_SECRET_KEY: RAW_SECRET }, `${PUBLIC_URL}/v1/x`);
    expect(cfg.enabled).toBe(true);
    expect(cfg.secret.equals(Buffer.from(RAW_SECRET, 'utf8'))).toBe(true);
    expect(cfg.realm).toBe('x.ngrok-free.dev');
    expect(cfg.chainId).toBe(8453);
  });

  it('decodes a hex MPP_SECRET_KEY to 32 bytes', () => {
    const cfg = loadMppConfig({ MPP_SECRET_KEY: HEX_SECRET }, PUBLIC_URL);
    expect(cfg.enabled).toBe(true);
    expect(cfg.secret.length).toBe(32);
  });

  it('throws at startup when MPP_SECRET_KEY is too short', () => {
    expect(() => loadMppConfig({ MPP_SECRET_KEY: 'short' }, PUBLIC_URL)).toThrow(/MPP_SECRET_KEY/);
  });

  it('passes chain context through (defaults to base 8453)', () => {
    expect(loadMppConfig({ MPP_SECRET_KEY: RAW_SECRET }, PUBLIC_URL).chainId).toBe(8453);
    expect(loadMppConfig({ MPP_SECRET_KEY: RAW_SECRET }, PUBLIC_URL, 84532).chainId).toBe(84532);
  });
});
