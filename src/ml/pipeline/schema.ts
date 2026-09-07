/**
 * SQLite schema for ML pipeline persistence.
 *
 * Adapted from agentic-graph/src/state/sqlite.ts with webcap-specific
 * ML pipeline tables. Uses WAL mode for concurrent readers.
 */

export const ML_PIPELINE_SCHEMA = `
-- Pipeline definitions (versioned)
CREATE TABLE IF NOT EXISTS ml_pipelines (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id, version)
);

-- Pipeline runs (execution state)
CREATE TABLE IF NOT EXISTS ml_runs (
  id TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL,
  pipeline_version INTEGER NOT NULL,
  parent_run_id TEXT,
  parent_node_id TEXT,
  status TEXT NOT NULL,
  input_json TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);

-- Node runs (per-node execution state)
CREATE TABLE IF NOT EXISTS ml_node_runs (
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  input_json TEXT,
  output_json TEXT,
  error_json TEXT,
  started_at TEXT,
  completed_at TEXT,
  PRIMARY KEY (run_id, node_id)
);

-- Events (audit trail)
CREATE TABLE IF NOT EXISTS ml_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  node_id TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(run_id, sequence)
);

-- Analysis results (cached)
CREATE TABLE IF NOT EXISTS ml_analysis_results (
  id TEXT PRIMARY KEY,
  url_hash TEXT NOT NULL,
  task TEXT NOT NULL,
  result_json TEXT NOT NULL,
  evidence_json TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ml_runs_status ON ml_runs(status);
CREATE INDEX IF NOT EXISTS idx_ml_runs_pipeline ON ml_runs(pipeline_id, pipeline_version);
CREATE INDEX IF NOT EXISTS idx_ml_events_run ON ml_events(run_id, sequence);
CREATE INDEX IF NOT EXISTS idx_ml_node_runs_status ON ml_node_runs(run_id, status);
CREATE INDEX IF NOT EXISTS idx_ml_analysis_url ON ml_analysis_results(url_hash, task);
CREATE INDEX IF NOT EXISTS idx_ml_analysis_expires ON ml_analysis_results(expires_at);
`;

/**
 * Initialize ML pipeline database.
 * Creates tables and indexes if they don't exist.
 */
export function initializeMLDatabase(db: { exec: (sql: string) => void }): void {
  db.exec(ML_PIPELINE_SCHEMA);
}
