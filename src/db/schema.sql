-- webcap schema (SQLite, WAL). Applied by src/db/index.ts at open time.

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credits INTEGER NOT NULL DEFAULT 0,
  address TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL DEFAULT 0 REFERENCES accounts(id),
  pack TEXT NOT NULL,
  chain TEXT NOT NULL,
  usdc_contract TEXT NOT NULL,
  usdc_address TEXT NOT NULL,
  amount_usd REAL NOT NULL,
  usdc_amount INTEGER NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credits_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER REFERENCES invoices(id),
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  from_addr TEXT NOT NULL,
  to_addr TEXT NOT NULL,
  value INTEGER NOT NULL,
  block INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(tx_hash, log_index)
);

CREATE TABLE IF NOT EXISTS poll_state (
  chain TEXT PRIMARY KEY,
  last_block INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS revenue_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL,
  payer TEXT NOT NULL DEFAULT '',
  revenue_usdc INTEGER NOT NULL,
  cost_usdc INTEGER NOT NULL,
  net_margin_usdc INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  format TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS watches (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  every TEXT NOT NULL,
  mode TEXT NOT NULL,
  schema_json TEXT,
  webhook_url TEXT,
  conditions_json TEXT,
  channel TEXT NOT NULL DEFAULT 'generic',
  headers_json TEXT,
  cookies_json TEXT,
  steps_json TEXT,
  summary_prompt_append TEXT,
  credits INTEGER NOT NULL DEFAULT 0,
  baseline_hash TEXT,
  baseline_json TEXT,
  next_run_at TEXT,
  paused INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_run_at TEXT
);

CREATE TABLE IF NOT EXISTS watch_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_id TEXT NOT NULL REFERENCES watches(id),
  status TEXT NOT NULL,
  artifact_url TEXT,
  extract_json TEXT,
  changed INTEGER NOT NULL DEFAULT 0,
  diff_summary TEXT,
  ai_summary TEXT,
  webhook TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS capture_jobs (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  format TEXT,
  status TEXT NOT NULL,
  artifact_url TEXT,
  error TEXT,
  payer TEXT,
  price_usdc_units INTEGER,
  credits_used INTEGER,
  cost_usdc_units INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS endpoint_hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL,
  status INTEGER NOT NULL,
  payer_hash TEXT NOT NULL DEFAULT 'anonymous',
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_endpoint_hits_endpoint_created ON endpoint_hits(endpoint, created_at);

CREATE TABLE IF NOT EXISTS payment_webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT 'payment.settled',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payment_webhooks_account_id ON payment_webhooks(account_id);

CREATE TABLE IF NOT EXISTS tracking_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  meta_json TEXT,
  referrer TEXT,
  user_agent TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tracking_events_event_created ON tracking_events(event, created_at);

/* deferred to run #4: per-endpoint rollup triggers (counts/revenue join) live here. */
