import type { FastifyReply } from 'fastify';
import { HttpError } from './errors.js';

interface Window {
  count: number;
  resetsAt: number;
}

/** Fixed-window in-memory rate limiter, keyed by an arbitrary string. */
export class RateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly windows = new Map<string, Window>();

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** true = the request is allowed within its current window. */
  allow(key: string): boolean {
    const now = Date.now();
    const window = this.windows.get(key);
    if (window === undefined || window.resetsAt <= now) {
      this.windows.set(key, { count: 1, resetsAt: now + this.windowMs });
      return true;
    }
    if (window.count >= this.limit) return false;
    window.count += 1;
    return true;
  }

  /**
   * Milliseconds until the key's current window resets: the back-off a blocked
   * caller should wait before retrying. 0 when no active window blocks the key.
   */
  retryAfterMs(key: string): number {
    const window = this.windows.get(key);
    if (window === undefined) return 0;
    return Math.max(0, window.resetsAt - Date.now());
  }
}

/**
 * The canonical 429 for a blocked key, shared by every rate-limited route:
 * `retry-after` header (integer seconds, >= 1) + the `rate_limited` envelope
 * whose `detail.retryAfterSeconds` matches the header. Always throws.
 */
export function rejectRateLimited(reply: FastifyReply, limiter: RateLimiter, key: string, message: string, extraDetail?: Record<string, unknown>): never {
  const retryAfterSeconds = Math.max(1, Math.ceil(limiter.retryAfterMs(key) / 1000));
  reply.header('retry-after', String(retryAfterSeconds));
  throw new HttpError(429, 'rate_limited', message, { retryAfterSeconds, ...extraDetail });
}
