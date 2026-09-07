/**
 * Plain-fetch JSON path for watches (no browser needed).
 *
 * - fetchJsonWatch: SSRF-guarded (validateCaptureUrl), AbortSignal.timeout
 *   budget, application/json content-type enforcement, byte-size cap, and
 *   stableStringify canonicalization. Never throws — every failure is a
 *   `{ ok: false, error }` result, mirroring executeWatch's error convention.
 * - executeJsonWatch: baseline store + diffJson changed detection + the
 *   keyword/priceBelow gate via conditionsMatch/parseConditionsField (the same
 *   helpers the scheduler uses — no fork). Pure over an injected fetch step so
 *   the scheduler (T6) can wire it to repo/webhook handling later; unit tests
 *   drive it directly.
 */
import { validateCaptureUrl } from '../util/url.js';
import { conditionsMatch, parseConditionsField, storedConditionsMet } from './conditions.js';
import { diffJson, stableStringify } from './diff.js';

/** Default per-request budget for a plain JSON fetch. */
export const DEFAULT_JSON_FETCH_TIMEOUT_MS = 10_000;

/** Default cap on the JSON body (bytes, UTF-8). */
export const DEFAULT_JSON_FETCH_MAX_BYTES = 1_000_000;

export interface JsonFetchOptions {
  /** Per-request budget in ms (default DEFAULT_JSON_FETCH_TIMEOUT_MS). */
  readonly timeoutMs?: number;
  /** Body cap in bytes (default DEFAULT_JSON_FETCH_MAX_BYTES). */
  readonly maxBytes?: number;
  /** Injectable fetch (tests stub it; production uses global fetch). */
  readonly fetchImpl?: typeof fetch;
}

export type JsonFetchResult =
  | { readonly ok: true; readonly data: unknown; readonly canonicalJson: string }
  | { readonly ok: false; readonly error: string };

/**
 * Fetch a URL as JSON. Returns `{ ok: false, error }` — never throws — for
 * SSRF-blocked URLs, timeouts, HTTP errors, non-JSON content, oversize
 * bodies, and invalid JSON.
 */
export async function fetchJsonWatch(url: string, opts: JsonFetchOptions = {}): Promise<JsonFetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_JSON_FETCH_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_JSON_FETCH_MAX_BYTES;
  const fetchImpl = opts.fetchImpl ?? fetch;

  try {
    validateCaptureUrl(url);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { ok: false, error: fetchErrorMessage(err, timeoutMs) };
  }

  if (!res.ok) return { ok: false, error: `json fetch failed: HTTP ${res.status}` };

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return { ok: false, error: `json fetch failed: unexpected content-type ${contentType || '(missing)'}` };
  }

  const declared = res.headers.get('content-length');
  if (declared !== null) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > maxBytes) {
      try {
        await res.body?.cancel();
      } catch {
        // Ignore cancellation errors: the oversize verdict stands.
      }
      return { ok: false, error: `json fetch failed: body too large (content-length ${declared} > ${maxBytes} bytes)` };
    }
  }

  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    return { ok: false, error: `json fetch failed: body too large (> ${maxBytes} bytes)` };
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'json fetch failed: invalid JSON body' };
  }
  return { ok: true, data, canonicalJson: stableStringify(data) };
}

function fetchErrorMessage(err: unknown, timeoutMs: number): string {
  if (typeof err === 'object' && err !== null && 'name' in err && err.name === 'TimeoutError') {
    return `json fetch failed: timed out after ${timeoutMs}ms`;
  }
  return err instanceof Error ? err.message : String(err);
}

export interface ExecuteJsonWatchInput {
  /** Stored baseline (stable JSON) or null for the first run. */
  readonly baselineJson: string | null;
  /** Stored conditions_json (null = no gate). */
  readonly conditionsJson: string | null;
  /** Injected fetch step (fetchJsonWatch bound to the watch URL in production). */
  readonly fetch: () => Promise<JsonFetchResult>;
}

export interface ExecuteJsonWatchOutcome {
  readonly status: 'ok' | 'error';
  readonly extractJson: string | null;
  readonly changed: boolean;
  readonly diffSummary: string | null;
  readonly conditionsMet: boolean;
  readonly error: string | null;
}

const ERROR_OUTCOME = {
  status: 'error',
  extractJson: null,
  changed: false,
  diffSummary: null,
  conditionsMet: false,
} as const;

/**
 * Run one JSON-watch check: fetch, diff against the baseline (first run
 * stores it with changed=false), and evaluate the stored conditions gate.
 * Never throws — mirrors executeWatch's outcome shape (status/error) so the
 * scheduler can record the run and update the baseline the same way.
 */
export async function executeJsonWatch(input: ExecuteJsonWatchInput): Promise<ExecuteJsonWatchOutcome> {
  let fetched: JsonFetchResult;
  try {
    fetched = await input.fetch();
  } catch (err) {
    return { ...ERROR_OUTCOME, error: err instanceof Error ? err.message : String(err) };
  }
  if (!fetched.ok) {
    return { ...ERROR_OUTCOME, error: fetched.error };
  }

  let changed = false;
  let diffSummary: string | null = null;
  try {
    if (input.baselineJson !== null) {
      const diff = diffJson(JSON.parse(input.baselineJson) as unknown, fetched.data);
      changed = diff.changed;
      diffSummary = changed ? diff.paths.join(', ') : null;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ...ERROR_OUTCOME, extractJson: fetched.canonicalJson, error: `json baseline failed: ${message}` };
  }

  return {
    status: 'ok',
    extractJson: fetched.canonicalJson,
    changed,
    diffSummary,
    conditionsMet: storedConditionsMet(input.conditionsJson, JSON.stringify(fetched.data)),
    error: null,
  };
}
