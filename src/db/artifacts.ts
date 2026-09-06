import type { Db } from './index.js';
import type { CaptureFormat } from '../capture/pipeline.js';

export interface ArtifactRow {
  readonly id: string;
  readonly source_url: string;
  readonly format: CaptureFormat;
  readonly mime: string;
  readonly bytes: Buffer;
  readonly created_at: string;
}

export interface ArtifactInput {
  readonly id: string;
  readonly sourceUrl: string;
  readonly format: CaptureFormat;
  readonly mime: string;
  readonly bytes: Buffer;
}

export interface ArtifactRepo {
  /** Persist one captured artifact (id is a UUID, set by the caller). */
  store(artifact: ArtifactInput): void;
  /** Load a stored artifact by id; null when it does not exist. */
  get(id: string): ArtifactRow | null;
  /** Delete artifacts strictly older than the cutoff; returns rows deleted. */
  purgeOlderThan(cutoffUtc: string): number;
}

export function makeArtifactRepo(db: Db): ArtifactRepo {
  const insertRow = db.prepare<[string, string, string, string, Buffer], unknown>(
    'INSERT INTO artifacts (id, source_url, format, mime, bytes) VALUES (?, ?, ?, ?, ?)',
  );
  const fetchRow = db.prepare<[string], ArtifactRow>(
    'SELECT id, source_url, format, mime, bytes, created_at FROM artifacts WHERE id = ?',
  );
  // created_at is stored as UTC 'YYYY-MM-DD HH:MM:SS' (datetime('now')); the
  // cutoff must use the same format or the lexicographic comparison is wrong.
  const purgeRows = db.prepare<[string], unknown>(
    'DELETE FROM artifacts WHERE created_at < ?',
  );

  return {
    store(artifact: ArtifactInput): void {
      insertRow.run(artifact.id, artifact.sourceUrl, artifact.format, artifact.mime, artifact.bytes);
    },
    get(id: string): ArtifactRow | null {
      return fetchRow.get(id) ?? null;
    },
    purgeOlderThan(cutoffUtc: string): number {
      return purgeRows.run(cutoffUtc).changes;
    },
  };
}

const DAY_MS = 86_400_000;

/**
 * One retention pass. retentionDays <= 0 (the default) is a no-op; otherwise
 * delete rows older than nowMs - retentionDays and return the row count.
 */
export function runRetentionSweep(repo: ArtifactRepo, nowMs: number, retentionDays: number): number {
  if (retentionDays <= 0) return 0;
  return repo.purgeOlderThan(cutoffUtcFor(nowMs, retentionDays));
}

function cutoffUtcFor(nowMs: number, retentionDays: number): string {
  const iso = new Date(nowMs - retentionDays * DAY_MS).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}
