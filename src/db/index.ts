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
