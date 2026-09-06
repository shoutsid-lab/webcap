/**
 * Persistence for scheduled watches + their runs (tables in src/db/schema.sql).
 *
 * All timestamps are ISO-8601 UTC strings (Date#toISOString); they compare
 * lexicographically, which is what the scheduler's `next_run_at <= now` due
 * check relies on. Callers own the clock: every write takes its timestamps
 * explicitly so unit tests stay deterministic.
 */
import type { Db } from '../db/index.js';
import type { WatchChannel } from './conditions.js';

export type WatchMode = 'capture' | 'extract' | 'json';
export type WatchRunStatus = 'ok' | 'error' | 'no-credit';

/**
 * Modes the HTTP API and top-up pricing accept. Routes and pricing stay
 * capture/extract-only (parseMode + watchTopUpPriceUsdcUnits untouched);
 * 'json' watches persist via the repo directly and execute in the scheduler.
 */
export type ApiWatchMode = 'capture' | 'extract';

export interface WatchRow {
  readonly id: string;
  readonly url: string;
  readonly every: string;
  readonly mode: ApiWatchMode;
  readonly schema_json: string | null;
  readonly webhook_url: string | null;
  readonly conditions_json: string | null;
  readonly channel: string;
  readonly headers_json: string | null;
  readonly cookies_json: string | null;
  readonly steps_json: string | null;
  readonly summary_prompt_append: string | null;
  readonly credits: number;
  readonly baseline_hash: string | null;
  readonly baseline_json: string | null;
  readonly next_run_at: string | null;
  readonly paused: 0 | 1;
  readonly created_at: string;
  readonly last_run_at: string | null;
}

export interface WatchRunRow {
  readonly id: number;
  readonly watch_id: string;
  readonly status: WatchRunStatus;
  readonly artifact_url: string | null;
  readonly extract_json: string | null;
  readonly changed: 0 | 1;
  readonly diff_summary: string | null;
  readonly ai_summary: string | null;
  /** Webhook delivery outcome (status code or error); null when no webhook fired. */
  readonly webhook: string | null;
  readonly error: string | null;
  readonly created_at: string;
}

export interface NewWatch {
  readonly id: string;
  readonly url: string;
  readonly every: string;
  readonly mode: WatchMode;
  readonly schemaJson: string | null;
  readonly webhookUrl: string | null;
  readonly conditionsJson: string | null;
  readonly channel: WatchChannel;
  readonly headersJson?: string | null;
  readonly cookiesJson?: string | null;
  readonly stepsJson?: string | null;
  readonly summaryPromptAppend?: string | null;
  readonly credits: number;
  readonly nextRunAt: string | null;
  readonly createdAt: string;
}

export interface NewWatchRun {
  readonly watchId: string;
  readonly status: WatchRunStatus;
  readonly artifactUrl: string | null;
  readonly extractJson: string | null;
  readonly changed: boolean;
  readonly diffSummary: string | null;
  readonly aiSummary?: string | null;
  readonly webhook: string | null;
  readonly error: string | null;
  readonly createdAt: string;
}

export interface WatchRepo {
  /** Insert a watch (id is a UUID, set by the caller). */
  create(watch: NewWatch): void;
  /** Load a watch by id; null when it does not exist. */
  get(id: string): WatchRow | null;
  /** Delete a watch and all of its runs. False when the watch does not exist. */
  delete(id: string): boolean;
  /** Non-paused watches whose next_run_at is at or before `at`, oldest first. */
  dueBefore(at: string): WatchRow[];
  /**
   * Charge one executed run: credits -= 1, next_run_at and last_run_at set.
   * The update is conditional on credits > 0; false when nothing was charged.
   */
  charge(id: string, nextRunAt: string, at: string): boolean;
  /** Record a run that executed nothing because the watch had no credits, and pause it. */
  recordNoCredit(watchId: string, at: string): number;
  /** Pause a watch (used when it runs out of credits). */
  pause(id: string): void;
  /**
   * Add a credit pack: credits += runs, paused reset to 0, and next_run_at
   * rescheduled to `at` when the watch was paused. Returns the new credit
   * balance, or null when the watch does not exist.
   */
  topUp(id: string, runs: number, at: string): number | null;
  /** Replace the stored baseline (hash for capture / stable JSON for extract). */
  setBaseline(id: string, baselineHash: string | null, baselineJson: string | null): void;
  /** Record one executed (ok/error) run. */
  recordRun(run: NewWatchRun): number;
  /** Recent runs for a watch, newest first, capped at limit. */
  recentRuns(watchId: string, limit: number): WatchRunRow[];
}

const selectRow =
  'SELECT id, url, every, mode, schema_json, webhook_url, conditions_json, channel, headers_json, cookies_json, steps_json, ' +
  'summary_prompt_append, credits, baseline_hash, baseline_json, next_run_at, paused, created_at, last_run_at FROM watches';

/**
 * Effective per-watch summary prompt suffix: the watch-level override wins,
 * otherwise the global default applies, otherwise no suffix. Null and
 * undefined both mean "unset" at either level.
 */
export function resolveSummaryPromptAppend(
  watchValue: string | null | undefined,
  globalDefault: string | null | undefined,
): string | undefined {
  return watchValue ?? globalDefault ?? undefined;
}

export function makeWatchRepo(db: Db): WatchRepo {
  const insertWatch = db.prepare<
    [
      string,
      string,
      string,
      string,
      string | null,
      string | null,
      string | null,
      string,
      string | null,
      string | null,
      string | null,
      string | null,
      number,
      string | null,
      string,
    ],
    unknown
  >(
    'INSERT INTO watches (id, url, every, mode, schema_json, webhook_url, conditions_json, channel, headers_json, cookies_json, ' +
      'steps_json, summary_prompt_append, credits, next_run_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const fetchWatch = db.prepare<[string], WatchRow>(`${selectRow} WHERE id = ?`);
  const deleteRuns = db.prepare<[string], unknown>('DELETE FROM watch_runs WHERE watch_id = ?');
  const deleteWatch = db.prepare<[string], unknown>('DELETE FROM watches WHERE id = ?');
  const dueRows = db.prepare<[string], WatchRow>(
    `${selectRow} WHERE paused = 0 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at ASC, id ASC`,
  );
  const chargeWatch = db.prepare<[string, string, string], unknown>(
    'UPDATE watches SET credits = credits - 1, next_run_at = ?, last_run_at = ? WHERE id = ? AND credits > 0',
  );
  const pauseWatch = db.prepare<[string], unknown>('UPDATE watches SET paused = 1 WHERE id = ?');
  const topUpWatch = db.prepare<[number, string, string], unknown>(
    'UPDATE watches SET credits = credits + ?, paused = 0, next_run_at = CASE WHEN paused = 1 THEN ? ELSE next_run_at END WHERE id = ?',
  );
  const setBaseline = db.prepare<[string | null, string | null, string], unknown>(
    'UPDATE watches SET baseline_hash = ?, baseline_json = ? WHERE id = ?',
  );
  const insertRun = db.prepare<
    [string, string, string | null, string | null, number, string | null, string | null, string | null, string | null, string],
    unknown
  >(
    'INSERT INTO watch_runs (watch_id, status, artifact_url, extract_json, changed, diff_summary, ai_summary, webhook, error, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const recentRunRows = db.prepare<[string, number], WatchRunRow>(
    'SELECT id, watch_id, status, artifact_url, extract_json, changed, diff_summary, ai_summary, webhook, error, created_at ' +
      'FROM watch_runs WHERE watch_id = ? ORDER BY id DESC LIMIT ?',
  );
  const watchCount = db.prepare<[string], { n: number }>('SELECT COUNT(*) AS n FROM watches WHERE id = ?');

  return {
    create(watch: NewWatch): void {
      insertWatch.run(
        watch.id,
        watch.url,
        watch.every,
        watch.mode,
        watch.schemaJson,
        watch.webhookUrl,
        watch.conditionsJson,
        watch.channel,
        watch.headersJson ?? null,
        watch.cookiesJson ?? null,
        watch.stepsJson ?? null,
        watch.summaryPromptAppend ?? null,
        watch.credits,
        watch.nextRunAt,
        watch.createdAt,
      );
    },
    get(id: string): WatchRow | null {
      return fetchWatch.get(id) ?? null;
    },
    delete(id: string): boolean {
      const perform = db.transaction((watchId: string): boolean => {
        const existing = watchCount.get(watchId);
        if (existing === undefined || existing.n === 0) return false;
        deleteRuns.run(watchId);
        deleteWatch.run(watchId);
        return true;
      });
      return perform(id);
    },
    dueBefore(at: string): WatchRow[] {
      return dueRows.all(at);
    },
    charge(id: string, nextRunAt: string, at: string): boolean {
      return chargeWatch.run(nextRunAt, at, id).changes > 0;
    },
    recordNoCredit(watchId: string, at: string): number {
      const record = db.transaction((id: string, when: string): number => {
        const info = insertRun.run(id, 'no-credit', null, null, 0, null, null, null, null, when);
        pauseWatch.run(id);
        return Number(info.lastInsertRowid);
      });
      return record(watchId, at);
    },
    pause(id: string): void {
      pauseWatch.run(id);
    },
    topUp(id: string, runs: number, at: string): number | null {
      if (fetchWatch.get(id) === undefined) return null;
      topUpWatch.run(runs, at, id);
      const row = fetchWatch.get(id);
      return row === undefined ? null : row.credits;
    },
    setBaseline(id: string, baselineHash: string | null, baselineJson: string | null): void {
      setBaseline.run(baselineHash, baselineJson, id);
    },
    recordRun(run: NewWatchRun): number {
      const info = insertRun.run(
        run.watchId,
        run.status,
        run.artifactUrl,
        run.extractJson,
        run.changed ? 1 : 0,
        run.diffSummary,
        run.aiSummary ?? null,
        run.webhook,
        run.error,
        run.createdAt,
      );
      return Number(info.lastInsertRowid);
    },
    recentRuns(watchId: string, limit: number): WatchRunRow[] {
      return recentRunRows.all(watchId, limit);
    },
  };
}
