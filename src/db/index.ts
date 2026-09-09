import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

/** Typed better-sqlite3 handle: WAL mode, foreign keys ON, schema applied. */
export type Db = Database.Database;

const schemaPath = resolve(dirname(fileURLToPath(import.meta.url)), 'schema.sql');

/**
 * Open (or create) the webcap database at `path` — a filesystem path or
 * `:memory:` for tests — and apply schema.sql. Caller owns the handle.
 */
export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(schemaPath, 'utf8'));
  migrateWatchChatOps(db);
  migrateWatchJsonAuth(db);
  migrateWatchAiSummary(db);
  migrateCaptureJobs(db);
  migrateEndpointHits(db);
  return db;
}

/**
 * Additive, nullable-tolerant migration for the T4-S1/S2 watch conditions +
 * ChatOps columns: existing rows stay valid (conditions NULL, channel
 * 'generic'); fresh databases already carry the columns via schema.sql.
 */
function migrateWatchChatOps(db: Db): void {
  const existing = new Set(
    (db.prepare('PRAGMA table_info(watches)').all() as Array<{ name: string }>).map((col) => col.name),
  );
  if (!existing.has('conditions_json')) db.exec('ALTER TABLE watches ADD COLUMN conditions_json TEXT');
  if (!existing.has('channel')) db.exec("ALTER TABLE watches ADD COLUMN channel TEXT NOT NULL DEFAULT 'generic'");
}

/**
 * Additive, nullable-tolerant migration for the watch JSON-mode + macro-auth
 * columns (headers/cookies/steps): existing rows stay valid (all three NULL,
 * i.e. legacy capture/extract behavior); fresh databases already carry the
 * columns via schema.sql.
 */
function migrateWatchJsonAuth(db: Db): void {
  const existing = new Set(
    (db.prepare('PRAGMA table_info(watches)').all() as Array<{ name: string }>).map((col) => col.name),
  );
  if (!existing.has('headers_json')) db.exec('ALTER TABLE watches ADD COLUMN headers_json TEXT');
  if (!existing.has('cookies_json')) db.exec('ALTER TABLE watches ADD COLUMN cookies_json TEXT');
  if (!existing.has('steps_json')) db.exec('ALTER TABLE watches ADD COLUMN steps_json TEXT');
}

/**
 * Additive, nullable-tolerant migration for the watch AI-summary columns
 * (watches.summary_prompt_append + watch_runs.ai_summary): existing rows stay
 * valid (both NULL, i.e. no prompt override and no cached summary); fresh
 * databases already carry the columns via schema.sql.
 */
function migrateWatchAiSummary(db: Db): void {
  const watchCols = new Set(
    (db.prepare('PRAGMA table_info(watches)').all() as Array<{ name: string }>).map((col) => col.name),
  );
  if (!watchCols.has('summary_prompt_append')) db.exec('ALTER TABLE watches ADD COLUMN summary_prompt_append TEXT');
  const runCols = new Set(
    (db.prepare('PRAGMA table_info(watch_runs)').all() as Array<{ name: string }>).map((col) => col.name),
  );
  if (!runCols.has('ai_summary')) db.exec('ALTER TABLE watch_runs ADD COLUMN ai_summary TEXT');
}

/**
 * Additive, nullable-tolerant migration for the async-capture capture_jobs
 * table: fresh databases already carry it via schema.sql; pre-existing
 * database files gain the table (or any missing nullable column) here so
 * they stay valid without a wipe. Every added column is nullable — existing
 * rows are untouched.
 */
function migrateCaptureJobs(db: Db): void {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'capture_jobs'")
    .get() as { name: string } | undefined;
  if (table === undefined) {
    db.exec(
      'CREATE TABLE capture_jobs (' +
        'id TEXT PRIMARY KEY, ' +
        'url TEXT NOT NULL, ' +
        'format TEXT, ' +
        'status TEXT NOT NULL, ' +
        'artifact_url TEXT, ' +
        'error TEXT, ' +
        'payer TEXT, ' +
        'price_usdc_units INTEGER, ' +
        'credits_used INTEGER, ' +
        'cost_usdc_units INTEGER, ' +
        "created_at TEXT NOT NULL, " +
        'updated_at TEXT NOT NULL)',
    );
    return;
  }
  const existing = new Set(
    (db.prepare('PRAGMA table_info(capture_jobs)').all() as Array<{ name: string }>).map((col) => col.name),
  );
  if (!existing.has('url')) db.exec('ALTER TABLE capture_jobs ADD COLUMN url TEXT NOT NULL DEFAULT \'\'');
  if (!existing.has('format')) db.exec('ALTER TABLE capture_jobs ADD COLUMN format TEXT');
  if (!existing.has('status')) db.exec("ALTER TABLE capture_jobs ADD COLUMN status TEXT NOT NULL DEFAULT 'queued'");
  if (!existing.has('artifact_url')) db.exec('ALTER TABLE capture_jobs ADD COLUMN artifact_url TEXT');
  if (!existing.has('error')) db.exec('ALTER TABLE capture_jobs ADD COLUMN error TEXT');
  if (!existing.has('payer')) db.exec('ALTER TABLE capture_jobs ADD COLUMN payer TEXT');
  if (!existing.has('price_usdc_units')) db.exec('ALTER TABLE capture_jobs ADD COLUMN price_usdc_units INTEGER');
  if (!existing.has('credits_used')) db.exec('ALTER TABLE capture_jobs ADD COLUMN credits_used INTEGER');
  if (!existing.has('cost_usdc_units')) db.exec('ALTER TABLE capture_jobs ADD COLUMN cost_usdc_units INTEGER');
  if (!existing.has('created_at')) db.exec("ALTER TABLE capture_jobs ADD COLUMN created_at TEXT NOT NULL DEFAULT ''");
  if (!existing.has('updated_at')) db.exec("ALTER TABLE capture_jobs ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
}

/**
 * Additive, idempotent migration for the metrics endpoint_hits table: fresh
 * databases already carry it via schema.sql; pre-existing database files gain
 * the table (or any missing nullable column) here so they stay valid without
 * a wipe. The raw payer is never stored — only the sha256 slice (payer_hash).
 */
function migrateEndpointHits(db: Db): void {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'endpoint_hits'")
    .get() as { name: string } | undefined;
  if (table === undefined) {
    db.exec(
      'CREATE TABLE endpoint_hits (' +
        'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
        'endpoint TEXT NOT NULL, ' +
        'status INTEGER NOT NULL, ' +
        "payer_hash TEXT NOT NULL DEFAULT 'anonymous', " +
        'duration_ms INTEGER, ' +
        'created_at TEXT NOT NULL)',
    );
    db.exec('CREATE INDEX IF NOT EXISTS idx_endpoint_hits_endpoint_created ON endpoint_hits(endpoint, created_at)');
    return;
  }
  const existing = new Set(
    (db.prepare('PRAGMA table_info(endpoint_hits)').all() as Array<{ name: string }>).map((col) => col.name),
  );
  if (!existing.has('endpoint')) db.exec("ALTER TABLE endpoint_hits ADD COLUMN endpoint TEXT NOT NULL DEFAULT ''");
  if (!existing.has('status')) db.exec('ALTER TABLE endpoint_hits ADD COLUMN status INTEGER NOT NULL DEFAULT 0');
  if (!existing.has('payer_hash')) db.exec("ALTER TABLE endpoint_hits ADD COLUMN payer_hash TEXT NOT NULL DEFAULT 'anonymous'");
  if (!existing.has('duration_ms')) db.exec('ALTER TABLE endpoint_hits ADD COLUMN duration_ms INTEGER');
  if (!existing.has('created_at')) db.exec("ALTER TABLE endpoint_hits ADD COLUMN created_at TEXT NOT NULL DEFAULT ''");
  db.exec('CREATE INDEX IF NOT EXISTS idx_endpoint_hits_endpoint_created ON endpoint_hits(endpoint, created_at)');
}
