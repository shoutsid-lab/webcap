/**
 * Retry helper for model (LLM) extraction calls.
 *
 * Policy: honor the server's Retry-After response header (delay-seconds and
 * HTTP-date forms), otherwise wait an exponential backoff with jitter, and
 * give up after a capped number of attempts or a capped overall timeout.
 * Only 429/500/503 and network errors (no HTTP status) are retried — any
 * other 4xx (including 402) propagates immediately without a retry.
 *
 * The sleep/now/random seams are injectable so unit tests can drive the
 * policy with fake timers and deterministic jitter.
 */

export interface AiRetryOptions {
  /** Total attempts including the first try (default 5, hard cap 10). */
  readonly maxAttempts?: number;
  /** Backoff for attempt N before jitter: min(maxDelayMs, base * 2^N) (default 500). */
  readonly baseDelayMs?: number;
  /** Ceiling for the computed exponential backoff (default 8000). */
  readonly maxDelayMs?: number;
  /** Overall budget from the first attempt; a wait crossing it throws (default 30000). */
  readonly timeoutMs?: number;
  /** Wait primitive (default setTimeout-based, so fake timers drive it). */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Clock primitive (default Date.now). */
  readonly now?: () => number;
  /** Jitter source in [0, 1) (default Math.random). */
  readonly random?: () => number;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const MAX_ATTEMPTS_CAP = 10;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 8_000;
const DEFAULT_TIMEOUT_MS = 30_000;

/** True only for the retryable statuses: 429, 500, 503. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 503;
}

/**
 * Parse a Retry-After header value to a non-negative millisecond delay.
 * Accepts delay-seconds ("120") and HTTP-dates ("Thu, 01 Jan 2026 00:00:05 GMT",
 * measured against nowMs). Returns undefined for missing/unparseable values.
 */
export function parseRetryAfterMs(value: string | null | undefined, nowMs: number = Date.now()): number | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  if (/^[0-9]+$/.test(trimmed)) return Number(trimmed) * 1_000;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return undefined;
  return Math.max(0, parsed - nowMs);
}

/**
 * Exponential backoff with equal jitter: a uniform sample from
 * [exp/2, exp] where exp = min(maxDelayMs, baseDelayMs * 2^attempt).
 */
export function computeBackoffMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number = Math.random,
): number {
  const safeAttempt = Math.max(0, attempt);
  const exponential = Math.min(Math.max(0, maxDelayMs), Math.max(0, baseDelayMs) * 2 ** safeAttempt);
  return exponential / 2 + random() * (exponential / 2);
}

/** True for network errors (no status) and retryable statuses; false for other 4xx. */
export function isRetryableError(err: unknown): boolean {
  const status = statusOf(err);
  if (status === undefined) return true;
  return isRetryableStatus(status);
}

/**
 * Run operation until it succeeds, retrying per the policy above.
 * The attempt index (0-based) is passed to the operation. Throws the last
 * error once maxAttempts is exhausted or the next wait would cross timeoutMs.
 */
export async function withAiRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: AiRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.min(
    MAX_ATTEMPTS_CAP,
    Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)),
  );
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const maxDelayMs = Math.max(0, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
  const timeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const startedAt = now();
  let lastError: unknown = new Error('withAiRetry exited without an attempt');
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (err) {
      lastError = err;
      if (!isRetryableError(err)) throw err;
      if (attempt === maxAttempts - 1) throw err;
      const elapsedMs = now() - startedAt;
      const header = retryAfterHeader(err);
      const serverDelay = header === undefined ? undefined : parseRetryAfterMs(header, now());
      const delayMs = serverDelay ?? computeBackoffMs(attempt, baseDelayMs, maxDelayMs, random);
      if (elapsedMs + delayMs >= timeoutMs) throw err;
      await sleep(delayMs);
    }
  }
  throw lastError;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Numeric HTTP status carried by the error (direct or nested), if any. */
function statusOf(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const direct = (err as { status?: unknown }).status;
  if (typeof direct === 'number' && Number.isInteger(direct)) return direct;
  const response = (err as { response?: unknown }).response;
  if (typeof response === 'object' && response !== null) {
    const nested = (response as { status?: unknown }).status;
    if (typeof nested === 'number' && Number.isInteger(nested)) return nested;
  }
  return undefined;
}

/** Raw Retry-After value from `retryAfter` or a Headers-like / record `headers`. */
function retryAfterHeader(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const holder = err as { retryAfter?: unknown; headers?: unknown };
  if (typeof holder.retryAfter === 'string') return holder.retryAfter;
  if (typeof holder.retryAfter === 'number' && Number.isFinite(holder.retryAfter)) {
    return String(holder.retryAfter);
  }
  const headers = holder.headers;
  if (typeof headers !== 'object' || headers === null) return undefined;
  const get = (headers as { get?: unknown }).get;
  if (typeof get === 'function') {
    const getter = get as (this: unknown, name: string) => unknown;
    const value = getter.call(headers, 'retry-after');
    return typeof value === 'string' ? value : undefined;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'retry-after' && typeof value === 'string') return value;
  }
  return undefined;
}
