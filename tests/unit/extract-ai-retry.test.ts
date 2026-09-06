import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computeBackoffMs,
  isRetryableStatus,
  parseRetryAfterMs,
  withAiRetry,
  type AiRetryOptions,
} from '../../src/extract/aiRetry.js';

// RED: retry policy for model extraction — honors Retry-After (delay-seconds
// + HTTP-date), exponential backoff with jitter, capped attempts / overall
// timeout, and retries ONLY 429/500/503 plus network errors. Any other 4xx
// propagates immediately without a retry.

/** Error carrying an HTTP status, mirroring fetch-failure shapes (status + Retry-After header). */
function httpError(status: number, retryAfter?: string): Error & { status: number; retryAfter?: string } {
  const err = new Error(`HTTP ${status}`) as Error & { status: number; retryAfter?: string };
  err.status = status;
  if (retryAfter !== undefined) err.retryAfter = retryAfter;
  return err;
}

/** Recording sleep that resolves immediately (no timers) unless fake timers drive it. */
function recordSleep(slept: number[]): (ms: number) => Promise<void> {
  return (ms: number): Promise<void> => {
    slept.push(ms);
    return Promise.resolve();
  };
}

function opts(over: AiRetryOptions = {}): AiRetryOptions {
  return { baseDelayMs: 200, maxDelayMs: 5_000, timeoutMs: 60_000, random: (): number => 0.5, ...over };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('extract/aiRetry retry policy', () => {
  it('retries only 429/500/503: each succeeds on the second attempt', async () => {
    for (const status of [429, 500, 503]) {
      const slept: number[] = [];
      let calls = 0;
      const result = await withAiRetry(
        (): Promise<string> => {
          calls += 1;
          if (calls === 1) throw httpError(status);
          return Promise.resolve('ok');
        },
        opts({ sleep: recordSleep(slept) }),
      );
      expect(result).toBe('ok');
      expect(calls).toBe(2);
      expect(slept).toHaveLength(1);
    }
  });

  it('retries network errors (no status) and succeeds', async () => {
    const slept: number[] = [];
    let calls = 0;
    const result = await withAiRetry(
      (): Promise<string> => {
        calls += 1;
        if (calls === 1) throw new TypeError('fetch failed');
        return Promise.resolve('ok');
      },
      opts({ sleep: recordSleep(slept) }),
    );
    expect(result).toBe('ok');
    expect(calls).toBe(2);
    expect(slept).toHaveLength(1);
  });

  it.each([400, 401, 402, 403, 404, 422])('propagates HTTP %i immediately without sleeping or retrying', async (status) => {
    const slept: number[] = [];
    let calls = 0;
    await expect(
      withAiRetry(
        (): Promise<string> => {
          calls += 1;
          throw httpError(status);
        },
        opts({ sleep: recordSleep(slept) }),
      ),
    ).rejects.toThrow(`HTTP ${status}`);
    expect(calls).toBe(1);
    expect(slept).toHaveLength(0);
  });

  it('isRetryableStatus is true only for 429/500/503', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    for (const s of [200, 400, 401, 402, 403, 404, 422, 502, 504]) expect(isRetryableStatus(s)).toBe(false);
  });

  it('parseRetryAfterMs parses delay-seconds', () => {
    expect(parseRetryAfterMs('2', 0)).toBe(2_000);
    expect(parseRetryAfterMs('0', 0)).toBe(0);
  });

  it('parseRetryAfterMs parses an HTTP-date relative to now', () => {
    const nowMs = Date.parse('2026-01-01T00:00:00.000Z');
    expect(parseRetryAfterMs('Thu, 01 Jan 2026 00:00:05 GMT', nowMs)).toBe(5_000);
    // A date in the past clamps to an immediate retry, never negative.
    expect(parseRetryAfterMs('Thu, 01 Jan 2026 00:00:00 GMT', nowMs)).toBe(0);
  });

  it('parseRetryAfterMs returns undefined for missing/garbage values', () => {
    expect(parseRetryAfterMs(undefined, 0)).toBeUndefined();
    expect(parseRetryAfterMs(null, 0)).toBeUndefined();
    expect(parseRetryAfterMs('', 0)).toBeUndefined();
    expect(parseRetryAfterMs('not-a-date', 0)).toBeUndefined();
  });

  it('honors Retry-After delay-seconds exactly (fake timers)', async () => {
    vi.useFakeTimers();
    const slept: number[] = [];
    const sleep = (ms: number): Promise<void> => {
      slept.push(ms);
      return new Promise<void>((resolve) => setTimeout(resolve, ms));
    };
    let calls = 0;
    const pending = withAiRetry(
      (): Promise<string> => {
        calls += 1;
        if (calls === 1) throw httpError(429, '2');
        return Promise.resolve('ok');
      },
      opts({ sleep, random: (): number => 0.999 }),
    );
    const assertion = expect(pending).resolves.toBe('ok');
    await vi.advanceTimersByTimeAsync(2_000);
    await assertion;
    expect(calls).toBe(2);
    expect(slept).toEqual([2_000]);
  });

  it('honors Retry-After HTTP-date (fake timers)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-01-01T00:00:00.000Z'));
    const slept: number[] = [];
    const sleep = (ms: number): Promise<void> => {
      slept.push(ms);
      return new Promise<void>((resolve) => setTimeout(resolve, ms));
    };
    let calls = 0;
    const pending = withAiRetry(
      (): Promise<string> => {
        calls += 1;
        if (calls === 1) throw httpError(503, 'Thu, 01 Jan 2026 00:00:03 GMT');
        return Promise.resolve('ok');
      },
      { ...opts({ sleep }), now: (): number => Date.now() },
    );
    const assertion = expect(pending).resolves.toBe('ok');
    await vi.advanceTimersByTimeAsync(3_000);
    await assertion;
    expect(calls).toBe(2);
    expect(slept).toEqual([3_000]);
  });

  it('backs off exponentially and caps at maxDelayMs', () => {
    const exp = (attempt: number): number => Math.min(5_000, 200 * 2 ** attempt);
    // random() = 0 pins the bottom of the jitter band (half the exponential).
    expect(computeBackoffMs(0, 200, 5_000, () => 0)).toBe(exp(0) / 2);
    expect(computeBackoffMs(1, 200, 5_000, () => 0)).toBe(exp(1) / 2);
    expect(computeBackoffMs(9, 200, 5_000, () => 0)).toBe(exp(9) / 2);
    expect(computeBackoffMs(0, 200, 5_000, () => 0)).toBeLessThan(computeBackoffMs(1, 200, 5_000, () => 0));
    expect(computeBackoffMs(1, 200, 5_000, () => 0)).toBeLessThan(computeBackoffMs(2, 200, 5_000, () => 0));
  });

  it('jitters within [half, full] of the exponential delay', () => {
    const lo = computeBackoffMs(2, 200, 5_000, () => 0);
    const hi = computeBackoffMs(2, 200, 5_000, () => 0.999_999);
    const exp = Math.min(5_000, 200 * 2 ** 2);
    expect(lo).toBe(exp / 2);
    expect(hi).toBeGreaterThan(lo);
    expect(hi).toBeLessThanOrEqual(exp);
    expect(computeBackoffMs(2, 200, 5_000, () => 0.5)).toBeGreaterThan(lo);
  });

  it('caps attempts: throws the last error after maxAttempts', async () => {
    const slept: number[] = [];
    let calls = 0;
    await expect(
      withAiRetry(
        (): Promise<string> => {
          calls += 1;
          throw httpError(503);
        },
        opts({ sleep: recordSleep(slept), maxAttempts: 3 }),
      ),
    ).rejects.toThrow('HTTP 503');
    expect(calls).toBe(3);
    expect(slept).toHaveLength(2);
  });

  it('caps total time: stops retrying once the timeout budget is spent (fake timers)', async () => {
    vi.useFakeTimers();
    const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms));
    let calls = 0;
    const pending = withAiRetry(
      (): Promise<string> => {
        calls += 1;
        throw httpError(500);
      },
      { baseDelayMs: 1_000, maxDelayMs: 10_000, timeoutMs: 1_500, sleep, now: (): number => Date.now() },
    );
    const assertion = expect(pending).rejects.toThrow('HTTP 500');
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    // First attempt + at most one backoff inside the 1500ms budget — never unbounded.
    expect(calls).toBeLessThanOrEqual(2);
  });
});
