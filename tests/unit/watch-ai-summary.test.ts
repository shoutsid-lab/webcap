import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';

const T0 = '2026-06-01T00:00:00.000Z';
const T1 = '2026-06-01T01:00:00.000Z';

type ColInfo = { name: string; notnull: number; dflt_value: string | null };

function colMap(db: { prepare: (sql: string) => { all: (...args: never[]) => unknown } }, table: string): Map<string, ColInfo> {
  const rows = (db.prepare(`PRAGMA table_info(${table})`) as unknown as { all: () => ColInfo[] }).all();
  return new Map(rows.map((c) => [c.name, c]));
}

describe('watch ai_summary migration (RED)', () => {
  it('fresh DB carries nullable watches.summary_prompt_append with no backfill', () => {
    const db = openDb(':memory:');
    try {
      const cols = colMap(db, 'watches');
      const col = cols.get('summary_prompt_append');
      expect(col).toBeDefined();
      expect(col?.notnull).toBe(0);
      db.exec(
        `INSERT INTO watches (id, url, every, mode, channel, credits, next_run_at, created_at) VALUES ` +
          `('w-noprompt', 'https://example.com/watch', '1h', 'capture', 'generic', 5, '${T1}', '${T0}')`,
      );
      const row = db
        .prepare('SELECT summary_prompt_append AS v FROM watches WHERE id = ?')
        .get('w-noprompt') as { v: string | null };
      expect(row.v).toBeNull();
    } finally {
      db.close();
    }
  });

  it('fresh DB carries nullable watch_runs.ai_summary with no backfill', () => {
    const db = openDb(':memory:');
    try {
      const cols = colMap(db, 'watch_runs');
      const col = cols.get('ai_summary');
      expect(col).toBeDefined();
      expect(col?.notnull).toBe(0);
      db.exec(
        `INSERT INTO watches (id, url, every, mode, channel, credits, next_run_at, created_at) VALUES ` +
          `('w-run', 'https://example.com/watch', '1h', 'capture', 'generic', 5, '${T1}', '${T0}')`,
      );
      db.exec(
        `INSERT INTO watch_runs (watch_id, status, changed, created_at) VALUES ('w-run', 'ok', 0, '${T1}')`,
      );
      const row = db
        .prepare('SELECT ai_summary AS v FROM watch_runs WHERE watch_id = ?')
        .get('w-run') as { v: string | null };
      expect(row.v).toBeNull();
    } finally {
      db.close();
    }
  });

  it('openDb is double-apply safe on an existing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'webcap-ai-summary-idem-'));
    try {
      const path = join(dir, 'idem.db');
      const first = openDb(path);
      first.exec(
        `INSERT INTO watches (id, url, every, mode, channel, credits, next_run_at, created_at) VALUES ` +
          `('w-idem', 'https://example.com/watch', '1h', 'capture', 'generic', 5, '${T1}', '${T0}')`,
      );
      first.close();
      const second = openDb(path);
      try {
        const cols = colMap(second, 'watches');
        expect(cols.has('summary_prompt_append')).toBe(true);
        const runCols = colMap(second, 'watch_runs');
        expect(runCols.has('ai_summary')).toBe(true);
        const row = second
          .prepare('SELECT summary_prompt_append AS v FROM watches WHERE id = ?')
          .get('w-idem') as { v: string | null };
        expect(row.v).toBeNull();
      } finally {
        second.close();
      }
      const third = openDb(path);
      try {
        expect(colMap(third, 'watches').has('summary_prompt_append')).toBe(true);
      } finally {
        third.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('legacy DB without the new columns migrates and old rows stay valid', () => {
    const dir = mkdtempSync(join(tmpdir(), 'webcap-ai-summary-legacy-'));
    try {
      const path = join(dir, 'legacy.db');
      const legacy = new Database(path);
      legacy.exec(
        'CREATE TABLE watches (' +
          'id TEXT PRIMARY KEY, ' +
          'url TEXT NOT NULL, ' +
          'every TEXT NOT NULL, ' +
          'mode TEXT NOT NULL, ' +
          'schema_json TEXT, ' +
          'webhook_url TEXT, ' +
          'credits INTEGER NOT NULL DEFAULT 0, ' +
          'baseline_hash TEXT, ' +
          'baseline_json TEXT, ' +
          'next_run_at TEXT, ' +
          'paused INTEGER NOT NULL DEFAULT 0, ' +
          'created_at TEXT NOT NULL, ' +
          'last_run_at TEXT)',
      );
      legacy.exec(
        'CREATE TABLE watch_runs (' +
          'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
          'watch_id TEXT NOT NULL REFERENCES watches(id), ' +
          'status TEXT NOT NULL, ' +
          'artifact_url TEXT, ' +
          'extract_json TEXT, ' +
          'changed INTEGER NOT NULL DEFAULT 0, ' +
          'diff_summary TEXT, ' +
          'webhook TEXT, ' +
          'error TEXT, ' +
          'created_at TEXT NOT NULL)',
      );
      legacy.exec(
        `INSERT INTO watches (id, url, every, mode, credits, next_run_at, created_at) VALUES ` +
          `('legacy-old', 'https://example.com/watch', '1h', 'capture', 5, '${T1}', '${T0}')`,
      );
      legacy.exec(`INSERT INTO watch_runs (watch_id, status, changed, created_at) VALUES ('legacy-old', 'ok', 0, '${T1}')`);
      legacy.close();

      const migrated = openDb(path);
      try {
        const watchCols = colMap(migrated, 'watches');
        expect(watchCols.get('summary_prompt_append')?.notnull).toBe(0);
        const runCols = colMap(migrated, 'watch_runs');
        expect(runCols.get('ai_summary')?.notnull).toBe(0);
        const watch = migrated
          .prepare('SELECT id AS id, summary_prompt_append AS v FROM watches WHERE id = ?')
          .get('legacy-old') as { id: string; v: string | null };
        expect(watch.id).toBe('legacy-old');
        expect(watch.v).toBeNull();
        const run = migrated
          .prepare('SELECT ai_summary AS v FROM watch_runs WHERE watch_id = ?')
          .get('legacy-old') as { v: string | null };
        expect(run.v).toBeNull();
      } finally {
        migrated.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
