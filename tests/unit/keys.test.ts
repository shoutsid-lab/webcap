import { describe, expect, it } from 'vitest';
import { generateApiKey, hashKey, verifyKey } from '../../src/util/keys.js';

describe('util/keys', () => {
  it('generateApiKey returns wc_live_ + 32 lowercase hex chars', () => {
    expect(generateApiKey()).toMatch(/^wc_live_[0-9a-f]{32}$/);
  });

  it('generated keys are unique across calls', () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateApiKey()));
    expect(keys.size).toBe(100);
  });

  it('hashKey is deterministic 64-hex sha256', () => {
    const key = `wc_live_${'ab'.repeat(16)}`;
    expect(hashKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashKey(key)).toBe(hashKey(key));
    expect(hashKey(key)).not.toBe(hashKey(`wc_live_${'cd'.repeat(16)}`));
  });

  it('verifyKey is true for the key matching its hash', () => {
    const key = generateApiKey();
    expect(verifyKey(key, hashKey(key))).toBe(true);
  });

  it('verifyKey is false for a different key or a malformed hash', () => {
    const key = generateApiKey();
    expect(verifyKey(generateApiKey(), hashKey(key))).toBe(false);
    expect(verifyKey(key, 'not-a-hash')).toBe(false);
    expect(verifyKey(key, '')).toBe(false);
  });
});
