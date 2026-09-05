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
}

export function makeArtifactRepo(db: Db): ArtifactRepo {
  const insertRow = db.prepare<[string, string, string, string, Buffer], unknown>(
    'INSERT INTO artifacts (id, source_url, format, mime, bytes) VALUES (?, ?, ?, ?, ?)',
  );
  const fetchRow = db.prepare<[string], ArtifactRow>(
    'SELECT id, source_url, format, mime, bytes, created_at FROM artifacts WHERE id = ?',
  );

  return {
    store(artifact: ArtifactInput): void {
      insertRow.run(artifact.id, artifact.sourceUrl, artifact.format, artifact.mime, artifact.bytes);
    },
    get(id: string): ArtifactRow | null {
      return fetchRow.get(id) ?? null;
    },
  };
}
