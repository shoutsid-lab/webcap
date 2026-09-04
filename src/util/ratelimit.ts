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
}
