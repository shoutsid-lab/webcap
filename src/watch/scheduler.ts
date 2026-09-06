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
 * - A changed run with a webhook set fires a change alert (fire-time SSRF
 *   guard + retrying delivery live in ./webhook.ts); the outcome is logged
 *   into the run record and a webhook failure never fails the run. A blocked
 *   URL is recorded on the run as 'skipped: <reason>', logged, and counted in
 *   stats().webhooksSkipped.
 *
 * The clock and timers are injectable so unit tests drive ticks deterministically
 * (createWatchScheduler + manual tick()); production wires the real ones via
 * startWatchScheduler() in src/main.ts.
 */
import type { ArtifactRepo } from '../db/artifacts.js';
import type { RevenueRepo } from '../db/revenue.js';
import { DEFAULT_MODEL_TIMEOUT_MS, DEFAULT_WEBHOOK_RETRIES, DEFAULT_WEBHOOK_TIMEOUT_MS, type WebcapConfig } from '../config.js';
import type { CaptureRequest, CaptureResult, StructuredCapture } from '../capture/pipeline.js';
import { captureOptionsOf } from './capture-context.js';
import { extractPage, storeArtifact } from '../extract/service.js';
import { consoleServiceLogger, type ServiceLogger } from '../util/logger.js';
import { diffJson, sha256Hex, stableStringify } from './diff.js';
import { everyMsOf } from './intervals.js';
import { fetchJsonWatch, executeJsonWatch } from './json-fetch.js';
import { defaultClock, defaultTimers, type WatchClock, type WatchTimers } from './clock.js';
import { checkWebhookUrl, fireWebhook, formatAlertPayload, type WatchAlert, type WatchChannel } from './webhook.js';
import { conditionsMatch, parseConditionsField, type ConditionContext } from './conditions.js';
import type { WatchMode, WatchRepo, WatchRow } from './store.js';

// Re-exported unchanged: the watch-scheduler unit tests import these from this module.
export type { WatchClock, WatchTimers } from './clock.js';

/** Default tick interval in production (spec: 15–30s). */
export const DEFAULT_TICK_INTERVAL_MS = 20_000;

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
    const mode = storedModeOf(watch);
    if (mode === 'json') {
      const outcome = await executeJsonWatch({
        baselineJson: watch.baseline_json,
        conditionsJson: watch.conditions_json,
        fetch: () => fetchJsonWatch(watch.url),
      });
      if (outcome.status === 'error') throw new Error(outcome.error ?? 'json watch failed');
      extractJson = outcome.extractJson;
      changed = outcome.changed;
      diffSummary = outcome.diffSummary;
      input.repo.setBaseline(watch.id, null, extractJson);
    } else if (mode === 'capture') {
      const options = captureOptionsOf(watch);
      const result = await input.pipeline.capture({
        url: watch.url,
        ...(options !== undefined ? { options } : {}),
      });
      artifactUrl = storeArtifact(input.artifacts, input.config, watch.url, result);
      const hash = sha256Hex(result.buffer);
      changed = watch.baseline_hash !== null && watch.baseline_hash !== hash;
      diffSummary = changed ? 'artifact' : null;
      input.repo.setBaseline(watch.id, hash, null);
    } else {
      const options = captureOptionsOf(watch);
      const data = await extractPage({
        url: watch.url,
        captureStructured: input.pipeline.captureStructured,
        schema: watch.schema_json,
        model: {
          baseUrl: input.config.modelApiBaseUrl,
          apiKey: input.config.modelApiKey,
          model: input.config.modelName,
        },
        modelTimeoutMs: input.config.modelTimeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS,
        logger: input.logger,
        ...(options !== undefined ? { captureOptions: options } : {}),
      });
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
  if (status === 'ok' && changed && watch.webhook_url !== null && storedConditionsMet(watch.conditions_json, extractJson)) {
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
      const legacy: Record<string, unknown> = {
        watchId: watch.id,
        url: watch.url,
        mode: watch.mode,
        changed: true,
        diffSummary,
        at,
      };
      if (artifactUrl !== null) legacy['artifactUrl'] = artifactUrl;
      if (extractJson !== null) legacy['extract'] = JSON.parse(extractJson);
      const channel = normalizeChannel(watch.channel);
      const alert: WatchAlert = {
        watchId: watch.id,
        url: watch.url,
        mode: watch.mode,
        diffSummary,
        at,
        artifactUrl,
        extract: extractJson !== null ? JSON.parse(extractJson) : null,
      };
      webhook = await fireWebhook(
        check.url,
        formatAlertPayload(channel, alert, legacy),
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

function normalizeChannel(raw: string): WatchChannel {
  return raw === 'slack' || raw === 'discord' ? raw : 'generic';
}

/**
 * The mode the scheduler executes. watches.mode may hold 'json'
 * (scheduler-persisted rows); the typed row surface stays API-narrow so
 * routes/pricing compile unchanged, and this boundary recovers the stored
 * value without a cast (a function return is never CFA-narrowed).
 */
function storedModeOf(watch: WatchRow): WatchMode {
  return watch.mode;
}

function conditionContextOf(extractJson: string | null): ConditionContext {
  let extract: unknown = null;
  if (extractJson !== null) {
    try {
      extract = JSON.parse(extractJson);
    } catch {
      extract = null;
    }
  }
  const markdown =
    typeof extract === 'object' && extract !== null && typeof (extract as Record<string, unknown>)['markdown'] === 'string'
      ? ((extract as Record<string, unknown>)['markdown'] as string)
      : null;
  return { markdown, extract };
}

function storedConditionsMet(conditionsJson: string | null, extractJson: string | null): boolean {
  if (conditionsJson === null) return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(conditionsJson);
  } catch {
    return false;
  }
  try {
    const conditions = parseConditionsField(parsed);
    return conditions === null ? true : conditionsMatch(conditions, conditionContextOf(extractJson));
  } catch {
    return false;
  }
}
