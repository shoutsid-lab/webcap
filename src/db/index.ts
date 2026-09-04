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
  return db;
}
