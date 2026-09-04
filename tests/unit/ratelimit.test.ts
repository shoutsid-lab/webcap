import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../../src/util/ratelimit.js';

describe('util/ratelimit', () => {
  it('allows exactly `limit` hits then blocks within the window', () => {
    const limiter = new RateLimiter(3, 60_000);
    expect([limiter.allow('k'), limiter.allow('k'), limiter.allow('k')]).toEqual([true, true, true]);
    expect(limiter.allow('k')).toBe(false);
    expect(limiter.allow('k')).toBe(false);
  });

  it('tracks keys independently', () => {
    const limiter = new RateLimiter(1, 60_000);
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('a')).toBe(false);
    expect(limiter.allow('b')).toBe(true);
  });

  it('resets once the window elapses', async () => {
    const limiter = new RateLimiter(1, 30);
    expect(limiter.allow('k')).toBe(true);
    expect(limiter.allow('k')).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(limiter.allow('k')).toBe(true);
  });
});
