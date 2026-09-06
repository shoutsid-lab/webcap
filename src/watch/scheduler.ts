/**
 * The recurring engine: an in-process tick loop that re-runs watches whose
 * next_run_at has come due.
 *
 * - A run reuses the same capture/extract pipeline the paid x402 route
 *   handlers call (merchant-initiated; no x402 self-payment).
 * - Cost of an executed run (ok or error) is accounted to the revenue ledger
 *   exactly like existing requests — cost side only (revenue 0; the money was
 *   already collected as run credits at top-up time).
 * - Each executed run consumes exactly 1 credit. A watch with 0 credits gets
 *   a 'no-credit' run, is paused, and executes nothing.
 * - Change detection: capture runs hash the artifact bytes (sha256); extract
 *   runs diff the extract JSON field-by-field. The first run stores the
 *   baseline (changed=false); later runs compare against it and replace it.
 * - A changed run with a webhook set fires a change alert (3 attempts, 5s
 *   timeout each); the delivery outcome is logged into the run record and a
 *   webhook failure never fails the run.
 * - The stored webhook_url is re-validated at fire time (checkWebhookUrl):
 *   the capture-target host policy (validateCaptureUrl) plus the https-only
 *   rule, so no request ever leaves the process to a private host even if a
 *   row predates the write-time guard. A blocked URL is recorded on the run
 *   as 'skipped: <reason>', logged, and counted in stats().webhooksSkipped.
 *
 * The clock and timers are injectable so unit tests drive ticks deterministically
 * (createWatchScheduler + manual tick()); production wires the real ones via
 * startWatchScheduler() in src/main.ts.
 */
import type { ArtifactRepo } from '../db/artifacts.js';
import type { RevenueRepo } from '../db/revenue.js';
import { DEFAULT_WEBHOOK_RETRIES, DEFAULT_WEBHOOK_TIMEOUT_MS, type WebcapConfig } from '../config.js';
import type { CaptureFormat, CaptureRequest, CaptureResult, StructuredCapture } from '../capture/pipeline.js';
import { modelExtract } from '../extract/model.js';
import { consoleServiceLogger, type ServiceLogger } from '../util/logger.js';
import { validateCaptureUrl } from '../util/url.js';
import { diffJson, sha256Hex, stableStringify } from './diff.js';
import type { WatchRepo, WatchRow } from './store.js';

export type WatchEvery = '15m' | '1h' | '6h' | '24h';
export const WATCH_EVERIES: readonly WatchEvery[] = ['15m', '1h', '6h', '24h'];
const EVERY_MS: Record<WatchEvery, number> = {
  '15m': 15 * 60_000,
  '1h': 3_600_000,
  '6h': 21_600_000,
  '24h': 86_400_000,
};

/** Default tick interval in production (spec: 15–30s). */
export const DEFAULT_TICK_INTERVAL_MS = 20_000;

const MIME_BY_FORMAT: Record<CaptureFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  pdf: 'application/pdf',
};

export interface WatchClock {
  /** Current time in epoch milliseconds. */
  nowMs(): number;
}

export interface WatchTimers {
  setInterval(callback: () => void, ms: number): NodeJS.Timeout;
  clearInterval(handle: NodeJS.Timeout): void;
}

export const defaultClock: WatchClock = { nowMs: () => Date.now() };
export const defaultTimers: WatchTimers = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle),
};

/** The capture/extract pipeline surface (the same functions the x402 routes call). */
export interface WatchPipeline {
  readonly capture: (req: CaptureRequest) => Promise<CaptureResult>;
  readonly captureStructured: (req: CaptureRequest) => Promise<StructuredCapture>;
}

export interface WatchSchedulerInput {
  readonly repo: WatchRepo;
  readonly pipeline: WatchPipeline;
  readonly artifacts: ArtifactRepo;
  readonly revenue: RevenueRepo;
  readonly config: WebcapConfig;
  /** Injectable clock (real Date.now by default). */
  readonly clock?: WatchClock;
  /** Injectable timers (real setInterval by default). */
  readonly timers?: WatchTimers;
  /** Tick interval in milliseconds (default DEFAULT_TICK_INTERVAL_MS). */
  readonly intervalMs?: number;
  /** Failure/skip logger (default: console, matching the historical output). */
  readonly logger?: ServiceLogger;
}

/** Cumulative scheduler counters (read-only snapshot per call). */
export interface WatchSchedulerStats {
  /** Change-alert deliveries skipped at fire time because the stored webhook_url failed the public-URL guard. */
  readonly webhooksSkipped: number;
}

export interface WatchScheduler {
  /** One scheduler pass: every due, non-running watch executes sequentially. */
  tick(): Promise<void>;
  /** Start the background loop with an immediate first pass (boot recovery). */
  start(): void;
  /** Stop the background loop; in-flight runs finish. */
  stop(): void;
  /** Counters accumulated since construction. */
  stats(): WatchSchedulerStats;
}

/** Build a scheduler WITHOUT starting any timer (tests call tick() directly). */
export function createWatchScheduler(input: WatchSchedulerInput): WatchScheduler {
  const clock = input.clock ?? defaultClock;
  const timers = input.timers ?? defaultTimers;
  const intervalMs = input.intervalMs ?? DEFAULT_TICK_INTERVAL_MS;
  const log = input.logger ?? consoleServiceLogger();
  /** Per-watch single-flight: a watch that is mid-run never double-runs. */
  const running = new Set<string>();
  // Accumulator mutated by executeWatch's webhook guard; exposed via stats().
  const stats = { webhooksSkipped: 0 };
  let timer: NodeJS.Timeout | undefined;
  let started = false;
  let tickInFlight = false;

  const tick = async (): Promise<void> => {
    if (tickInFlight) return;
    tickInFlight = true;
    try {
      const nowMs = clock.nowMs();
      const due = input.repo.dueBefore(new Date(nowMs).toISOString());
      for (const watch of due) {
        if (running.has(watch.id)) continue;
        running.add(watch.id);
        try {
          const webhooksSkipped = await executeWatch(input, watch, nowMs);
          stats.webhooksSkipped += webhooksSkipped;
        } finally {
          running.delete(watch.id);
        }
      }
    } finally {
      tickInFlight = false;
    }
  };

  const scheduleTick = (): void => {
    void tick().catch((err: unknown) => {
      log.error('webcap watch scheduler tick failed:', err);
    });
  };

  return {
    tick,
    start(): void {
      if (started) return;
      started = true;
      scheduleTick(); // boot recovery: overdue watches run on the first pass
      timer = timers.setInterval(scheduleTick, intervalMs);
    },
    stop(): void {
      if (!started) return;
      started = false;
      if (timer !== undefined) timers.clearInterval(timer);
      timer = undefined;
    },
    stats(): WatchSchedulerStats {
      return { webhooksSkipped: stats.webhooksSkipped };
    },
  };
}

/** Build the scheduler and start it (wired into src/main.ts at app boot). */
export function startWatchScheduler(input: WatchSchedulerInput): WatchScheduler {
  const scheduler = createWatchScheduler(input);
  scheduler.start();
  return scheduler;
}

/**
 * Execute one due watch. Returns how many webhook deliveries the fire-time
 * URL guard skipped (0 or 1); the caller accumulates it into stats().
 */
async function executeWatch(input: WatchSchedulerInput, watch: WatchRow, nowMs: number): Promise<number> {
  const log = input.logger ?? consoleServiceLogger();
  const at = new Date(nowMs).toISOString();
  if (watch.credits <= 0) {
    // Nothing executes, nothing is consumed; the watch is paused until a top-up.
    input.repo.recordNoCredit(watch.id, at);
    return 0;
  }

  let status: 'ok' | 'error' = 'ok';
  let error: string | null = null;
  let artifactUrl: string | null = null;
  let extractJson: string | null = null;
  let changed = false;
  let diffSummary: string | null = null;

  try {
    if (watch.mode === 'capture') {
      const result = await input.pipeline.capture({ url: watch.url });
      artifactUrl = storeArtifact(input, watch.url, result);
      const hash = sha256Hex(result.buffer);
      changed = watch.baseline_hash !== null && watch.baseline_hash !== hash;
      diffSummary = changed ? 'artifact' : null;
      input.repo.setBaseline(watch.id, hash, null);
    } else {
      const data = await extractWatchData(input, watch);
      extractJson = stableStringify(data);
      if (watch.baseline_json !== null) {
        const diff = diffJson(JSON.parse(watch.baseline_json), data);
        changed = diff.changed;
        diffSummary = changed ? diff.paths.join(', ') : null;
      }
      input.repo.setBaseline(watch.id, null, extractJson);
    }
  } catch (err) {
    status = 'error';
    error = err instanceof Error ? err.message : String(err);
  }

  // Cost side only: the run's compute cost, accounted like any other request.
  input.revenue.record({
    endpoint: `watch-${watch.mode}`,
    payer: 'scheduler',
    revenueUsdcUnits: 0,
    costUsdcUnits: input.config.computeCostUsdcUnitsPerRequest,
  });
  const nextRunAt = new Date(nowMs + everyMsOf(watch.every)).toISOString();
  if (!input.repo.charge(watch.id, nextRunAt, at)) {
    throw new Error(`watch ${watch.id}: credit vanished between check and charge`);
  }

  let webhook: string | null = null;
  let webhooksSkipped = 0;
  if (status === 'ok' && changed && watch.webhook_url !== null) {
    const check = checkWebhookUrl(watch.webhook_url);
    if (!check.ok) {
      // SSRF backstop: the stored URL is private/non-https; nothing is sent.
      webhooksSkipped = 1;
      log.warn('webcap watch scheduler: webhook delivery skipped (fire-time URL guard)', {
        watchId: watch.id,
        webhookUrl: watch.webhook_url,
        reason: check.reason,
      });
      webhook = `skipped: ${check.reason}`;
    } else {
      const payload: Record<string, unknown> = {
        watchId: watch.id,
        url: watch.url,
        mode: watch.mode,
        changed: true,
        diffSummary,
        at,
      };
      if (artifactUrl !== null) payload['artifactUrl'] = artifactUrl;
      if (extractJson !== null) payload['extract'] = JSON.parse(extractJson);
      webhook = await fireWebhook(
        check.url,
        payload,
        input.config.webhookRetries ?? DEFAULT_WEBHOOK_RETRIES,
        input.config.webhookTimeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS,
      );
    }
  }

  input.repo.recordRun({
    watchId: watch.id,
    status,
    artifactUrl,
    extractJson,
    changed,
    diffSummary,
    webhook,
    error,
    createdAt: at,
  });
  return webhooksSkipped;
}

/** Mirror of the /v1/x402/extract handler for a single URL (minus payment). */
async function extractWatchData(
  input: WatchSchedulerInput,
  watch: WatchRow,
): Promise<Record<string, unknown>> {
  const schema = watch.schema_json;
  const config = input.config;
  const wantsModel =
    schema !== null && config.modelApiKey !== '' && config.modelApiBaseUrl !== '' && config.modelName !== '';
  const captured = await input.pipeline.captureStructured({ url: watch.url, options: { includeHtml: wantsModel } });
  let extracted: Record<string, unknown> | undefined;
  if (schema !== null) {
    extracted = await modelExtract(captured.html, schema, {
      baseUrl: config.modelApiBaseUrl,
      apiKey: config.modelApiKey,
      model: config.modelName,
    }, undefined, input.logger);
  }
  return extracted === undefined ? { ...captured.structure } : { ...captured.structure, extracted };
}

/** Mirror of the artifact store closure in src/server/routes.ts. */
function storeArtifact(input: WatchSchedulerInput, sourceUrl: string, result: CaptureResult): string {
  const id = crypto.randomUUID();
  input.artifacts.store({
    id,
    sourceUrl,
    format: result.format,
    mime: MIME_BY_FORMAT[result.format],
    bytes: result.buffer,
  });
  return `${input.config.publicBaseUrl}/v1/artifacts/${id}`;
}

/** Fire-time verdict for a stored webhook URL (see checkWebhookUrl). */
type WebhookUrlCheck =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Fire-time SSRF guard for a stored webhook URL. Write-time validation
 * (src/server/watches.ts) enforces the same rule, but the stored row is
 * re-checked before any request leaves the process: a row may predate the
 * write-time guard or have been written out-of-band. Composed rule: the
 * capture-target host policy (validateCaptureUrl — no private/loopback/
 * link-local hosts, http/https schemes only) AND the https:// requirement.
 * Purely parse-level (validateCaptureUrl does no DNS), so fire-time cost is
 * negligible for a rarely fired webhook.
 */
function checkWebhookUrl(raw: string): WebhookUrlCheck {
  let normalized: string;
  try {
    normalized = validateCaptureUrl(raw);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  if (!normalized.startsWith('https://')) {
    return { ok: false, reason: 'webhook must be https' };
  }
  return { ok: true, url: normalized };
}

/**
 * Deliver a change alert: POST the payload with up to `attempts` attempts
 * (one `timeoutMs` budget each). Never throws — the outcome ("ok: HTTP 200" or
 * "failed: …") is returned and stored on the run record. Callers must pass a
 * URL that passed checkWebhookUrl (fire-time SSRF guard).
 */
async function fireWebhook(
  url: string,
  payload: Record<string, unknown>,
  attempts: number,
  timeoutMs: number,
): Promise<string> {
  const body = JSON.stringify(payload);
  let lastFailure: string | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let failure: string | undefined;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status >= 200 && res.status < 300) return `ok: HTTP ${res.status}`;
      failure = `HTTP ${res.status}`;
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }
    lastFailure = failure;
  }
  return `failed: ${lastFailure ?? 'unknown error'}`;
}

function everyMsOf(every: string): number {
  if (every === '15m') return EVERY_MS['15m'];
  if (every === '1h') return EVERY_MS['1h'];
  if (every === '6h') return EVERY_MS['6h'];
  if (every === '24h') return EVERY_MS['24h'];
  throw new Error(`unknown watch interval: ${every}`);
}
