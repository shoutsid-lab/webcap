-- webcap schema (SQLite, WAL). Applied by src/db/index.ts at open time.

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credits INTEGER NOT NULL DEFAULT 0,
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
