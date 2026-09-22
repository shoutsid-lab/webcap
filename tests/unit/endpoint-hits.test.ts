import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/index.js';
import {
  hashPayer,
  normalizeEndpoint,
  normalizeUserAgent,
  recordHit,
  registerHitsHook,
  summaryByEndpoint,
} from '../../src/db/hits.js';

function sha16(payer: string): string {
  return createHash('sha256').update(payer, 'utf8').digest('hex').slice(0, 16);
}

describe('metrics: endpoint_hits write path (RED)', () => {
  it('one request → one row with endpoint, status, payer_hash, created_at', () => {
    const db = openDb(':memory:');
    recordHit(db, { endpoint: 'GET /v1/capture', status: 200, payer: '0xabc' });
    const rows = db
      .prepare<[], { endpoint: string; status: number; payer_hash: string; created_at: string }>(
        'SELECT endpoint, status, payer_hash, created_at FROM endpoint_hits',
      )
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.endpoint).toBe('GET /v1/capture');
    expect(rows[0]?.status).toBe(200);
    expect(rows[0]?.payer_hash).toBe(sha16('0xabc'));
    expect(typeof rows[0]?.created_at).toBe('string');
    db.close();
  });

  it('double migration is safe: reopening the same file keeps rows and throws nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'webcap-hits-'));
    const path = join(dir, 'hits.db');
    const first = openDb(path);
    recordHit(first, { endpoint: 'GET /v1/capture', status: 200 });
    first.close();
    const second = openDb(path);
    // Re-applying the migration on an existing file must not throw or wipe rows.
    const reopened = openDb(path);
    reopened.close();
    const rows = second.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM endpoint_hits').get();
    expect(rows?.n).toBe(1);
    second.close();
  });

  it('unknown endpoints are recorded verbatim (normalized, never dropped)', () => {
    const db = openDb(':memory:');
    recordHit(db, { endpoint: normalizeEndpoint('GET', '/v1/nope?x=1'), status: 404 });
    const rows = summaryByEndpoint(db);
    expect(rows.some((row: { endpoint: string; hits: number }) => row.endpoint === 'GET /v1/nope' && row.hits === 1)).toBe(true);
    db.close();
  });

  it('raw payer is NEVER stored: only the sha256 slice lands in payer_hash', () => {
    const db = openDb(':memory:');
    const raw = '0xdeadbeefcafe1234';
    recordHit(db, { endpoint: 'POST /v1/capture', status: 200, payer: raw });
    const cols = (
      db.prepare('PRAGMA table_info(endpoint_hits)').all() as Array<{ name: string }>
    ).map((col) => col.name);
    expect(cols).toContain('payer_hash');
    expect(cols).not.toContain('payer');
    const row = db
      .prepare<[], { payer_hash: string }>('SELECT payer_hash FROM endpoint_hits LIMIT 1')
      .get();
    expect(row?.payer_hash).toBe(sha16(raw));
    expect(row?.payer_hash).not.toContain(raw);
    // The raw value must not appear anywhere in the table dump.
    const dump = JSON.stringify(db.prepare('SELECT * FROM endpoint_hits').all());
    expect(dump).not.toContain(raw);
    expect(hashPayer(raw)).toBe(sha16(raw));
    expect(hashPayer(undefined)).toBe('anonymous');
    db.close();
  });

  it('hook-throws → request still settles: a failing write never 500s a paid request', async () => {
    const db = openDb(':memory:');
    const app = Fastify();
    registerHitsHook(app, db);
    app.get('/v1/capture', () => ({ ok: true }));
    // Break the write path after registration: the hook must swallow the failure.
    db.close();
    const res = await app.inject({ method: 'GET', url: '/v1/capture' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('onResponse hook records one row per request, fire-and-forget', async () => {
    const db = openDb(':memory:');
    const app = Fastify();
    registerHitsHook(app, db);
    app.get('/v1/capture', () => ({ ok: true }));
    const res = await app.inject({ method: 'GET', url: '/v1/capture?url=https://example.com' });
    expect(res.statusCode).toBe(200);
    const rows = db
      .prepare<[], { endpoint: string; status: number }>(
        'SELECT endpoint, status FROM endpoint_hits',
      )
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ endpoint: 'GET /v1/capture', status: 200 });
    await app.close();
    db.close();
  });

  it('user agent is stored raw (attribution), trimmed and capped at 200 chars', () => {
    const db = openDb(':memory:');
    recordHit(db, { endpoint: 'POST /v1/x402/capture', status: 402, userAgent: '  x402-census-probe/1.0  ' });
    recordHit(db, { endpoint: 'POST /v1/x402/capture', status: 402, userAgent: `bot/${'x'.repeat(300)}` });
    recordHit(db, { endpoint: 'POST /v1/x402/capture', status: 402 });
    const rows = db
      .prepare<[], { user_agent: string }>('SELECT user_agent FROM endpoint_hits ORDER BY id')
      .all();
    expect(rows.map((r) => r.user_agent)).toEqual([
      'x402-census-probe/1.0',
      `bot/${'x'.repeat(196)}`,
      '',
    ]);
    db.close();
  });

  it('normalizeUserAgent: arrays take the first value, whitespace-only becomes empty', () => {
    expect(normalizeUserAgent(undefined)).toBe('');
    expect(normalizeUserAgent('  ')).toBe('');
    expect(normalizeUserAgent(['second-ignored', 'first-kept'].reverse())).toBe('first-kept');
    expect(normalizeUserAgent('a'.repeat(201)).length).toBe(200);
    expect(normalizeUserAgent('ok/1.0').length).toBe(6);
  });

  it('hook captures the request User-Agent header into the hit row', async () => {
    const db = openDb(':memory:');
    const app = Fastify();
    registerHitsHook(app, db);
    app.get('/v1/capture', () => ({ ok: true }));
    const res = await app.inject({
      method: 'GET',
      url: '/v1/capture',
      headers: { 'user-agent': 'carbon-monitor/2.1' },
    });
    expect(res.statusCode).toBe(200);
    const row = db.prepare<[], { user_agent: string }>('SELECT user_agent FROM endpoint_hits').get();
    expect(row?.user_agent).toBe('carbon-monitor/2.1');
    await app.close();
    db.close();
  });

  it('migration adds user_agent to a pre-existing table without wiping rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'webcap-hits-ua-'));
    const path = join(dir, 'hits.db');
    {
      const raw = openDb(path);
      raw.exec('DROP TABLE endpoint_hits');
      raw.exec(
        'CREATE TABLE endpoint_hits (id INTEGER PRIMARY KEY AUTOINCREMENT, endpoint TEXT NOT NULL, ' +
          'status INTEGER NOT NULL, payer_hash TEXT NOT NULL DEFAULT \'anonymous\', ' +
          'duration_ms INTEGER, created_at TEXT NOT NULL)',
      );
      raw.exec(
        "INSERT INTO endpoint_hits (endpoint, status, payer_hash, created_at) VALUES ('GET /old', 200, 'anonymous', '2026-01-01T00:00:00.000Z')",
      );
      raw.close();
    }
    const db = openDb(path);
    const cols = (db.prepare('PRAGMA table_info(endpoint_hits)').all() as Array<{ name: string }>).map(
      (col) => col.name,
    );
    expect(cols).toContain('user_agent');
    const rows = db.prepare<[], { endpoint: string; user_agent: string }>('SELECT endpoint, user_agent FROM endpoint_hits').all();
    expect(rows).toEqual([{ endpoint: 'GET /old', user_agent: '' }]);
    recordHit(db, { endpoint: 'GET /new', status: 200, userAgent: 'probe/1' });
    expect(db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM endpoint_hits').get()?.n).toBe(2);
    db.close();
  });
});
