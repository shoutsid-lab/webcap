import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../../src/db/index.js';
import { makeArtifactRepo, runRetentionSweep, type ArtifactRepo } from '../../src/db/artifacts.js';

const DAY_MS = 86_400_000;
// Fixed reference "now" so ages are deterministic regardless of wall clock.
const T0 = Date.parse('2026-09-06T00:00:00.000Z');

function store(repo: ArtifactRepo, id: string): void {
  repo.store({
    id,
    sourceUrl: `https://example.com/${id}`,
    format: 'png',
    mime: 'image/png',
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
}

describe('artifact retention sweep', () => {
  let dir: string;
  let db: Db;
  let repo: ArtifactRepo;

  // created_at is UTC 'YYYY-MM-DD HH:MM:SS' (datetime('now')); age rows in the
  // same format for a clean lexicographic cutoff comparison.
  const ageRow = (id: string, daysAgo: number): void => {
    const iso = new Date(T0 - daysAgo * DAY_MS).toISOString();
    db.prepare('UPDATE artifacts SET created_at = ? WHERE id = ?').run(`${iso.slice(0, 10)} ${iso.slice(11, 19)}`, id);
  };

  // Fresh store per test: a sweep sees only the rows the test itself stored.
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'webcap-artifacts-'));
    db = openDb(join(dir, 'artifacts.db'));
    repo = makeArtifactRepo(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('retention 0: sweep is a no-op, even for old rows', () => {
    store(repo, 'a-old');
    ageRow('a-old', 30);
    expect(runRetentionSweep(repo, T0, 0)).toBe(0);
    expect(repo.get('a-old')).not.toBeNull();
  });

  it('retention > 0: deletes rows older than the cutoff, keeps newer rows', () => {
    store(repo, 'b-old');
    store(repo, 'b-new');
    ageRow('b-old', 8); // past the 7-day cutoff (2026-08-30 00:00:00 UTC)
    ageRow('b-new', 1);
    const swept = runRetentionSweep(repo, T0, 7);
    expect(swept).toBe(1);
    expect(repo.get('b-old')).toBeNull();
    expect(repo.get('b-new')).not.toBeNull();
  });
});
