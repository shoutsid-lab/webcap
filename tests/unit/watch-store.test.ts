import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { openDb, type Db } from '../../src/db/index.js';
import { makeWatchRepo, type WatchRepo } from '../../src/watch/store.js';

const T0 = '2026-06-01T00:00:00.000Z';
const T1 = '2026-06-01T01:00:00.000Z';

const HEADERS = JSON.stringify({ authorization: 'Bearer s3cr3t', 'x-api-key': 'k-123' });
const COOKIES = JSON.stringify([{ name: 'sid', value: 'abc', domain: 'example.com' }]);
const STEPS = JSON.stringify([
  { type: 'goto', url: 'https://example.com/login' },
  { type: 'type', selector: '#user', text: 'u' },
  { type: 'click', selector: '#go' },
  { type: 'wait', timeoutMs: 500 },
]);

function seedJsonAuthWatch(repo: WatchRepo, id: string): void {
  repo.create({
    id,
    url: 'https://example.com/watch',
    every: '1h',
    mode: 'json',
    schemaJson: null,
    webhookUrl: null,
    conditionsJson: null,
    channel: 'generic',
    headersJson: HEADERS,
    cookiesJson: COOKIES,
    stepsJson: STEPS,
    credits: 5,
    nextRunAt: T1,
    createdAt: T0,
  });
}

describe('watch store json-mode + macro-auth columns (RED)', () => {
  let db: Db;
  let repo: WatchRepo;

  beforeEach(() => {
    db = openDb(':memory:');
    repo = makeWatchRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  it('round-trips nullable headers_json/cookies_json/steps_json on get', () => {
    seedJsonAuthWatch(repo, 'w-json');
    const row = repo.get('w-json');
    expect(row).toMatchObject({
      id: 'w-json',
      mode: 'json',
      headers_json: HEADERS,
      cookies_json: COOKIES,
      steps_json: STEPS,
    });
  });

  it('carries the new columns on dueBefore rows', () => {
    seedJsonAuthWatch(repo, 'w-due');
    const due = repo.dueBefore(T1);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      id: 'w-due',
      headers_json: HEADERS,
      cookies_json: COOKIES,
      steps_json: STEPS,
    });
  });

  it('watches stored without the new columns read back as null (old rows stay valid)', () => {
    db.exec(
      `INSERT INTO watches (id, url, every, mode, channel, credits, next_run_at, created_at) VALUES ` +
        `('w-old', 'https://example.com/watch', '1h', 'capture', 'generic', 5, '${T1}', '${T0}')`,
    );
    const row = repo.get('w-old');
    expect(row).toMatchObject({
      id: 'w-old',
      mode: 'capture',
      headers_json: null,
      cookies_json: null,
      steps_json: null,
    });
  });

  it('pre-migration database file opens, migrates, and old watches stay valid', () => {
    const dir = mkdtempSync(join(tmpdir(), 'webcap-watch-migrate-'));
    try {
      const path = join(dir, 'legacy.db');
      const legacy = new Database(path);
      // The original watches shape: no conditions_json/channel, no json-auth columns.
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
        `INSERT INTO watches (id, url, every, mode, credits, next_run_at, created_at) VALUES ` +
          `('legacy-old', 'https://example.com/watch', '1h', 'capture', 5, '${T1}', '${T0}')`,
      );
      legacy.close();

      const migrated = openDb(path);
      try {
        const cols = (
          migrated.prepare('PRAGMA table_info(watches)').all() as Array<{ name: string }>
        ).map((col) => col.name);
        for (const col of ['conditions_json', 'channel', 'headers_json', 'cookies_json', 'steps_json']) {
          expect(cols).toContain(col);
        }
        const row = makeWatchRepo(migrated).get('legacy-old');
        expect(row).toMatchObject({
          id: 'legacy-old',
          mode: 'capture',
          conditions_json: null,
          channel: 'generic',
          headers_json: null,
          cookies_json: null,
          steps_json: null,
        });
      } finally {
        migrated.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
