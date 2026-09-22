import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { openDb, migrateTrialClaims, type Db } from '../../src/db/index.js';
import {
  FAUCET_DAILY_LIMIT,
  makeFaucetRepo,
  makeTrialsRepo,
  trialMessage,
  trialMessageFor,
} from '../../src/db/trials.js';

function freshDb(): Db {
  return openDb(':memory:');
}

describe('trial claim messages', () => {
  it('endpoint-bound messages differ per endpoint; legacy capture message is unchanged', () => {
    const payer = '0xabc0000000000000000000000000000000000001';
    expect(trialMessage(payer)).toBe('Claim one free webcap trial capture for 0xabc0000000000000000000000000000000000001');
    expect(trialMessageFor('capture', payer)).toBe(trialMessage(payer));
    expect(trialMessageFor('extract', payer)).toBe('Claim one free webcap trial extract for 0xabc0000000000000000000000000000000000001');
    expect(trialMessageFor('analyze', payer)).not.toBe(trialMessageFor('extract', payer));
  });
});

describe('makeTrialsRepo — one claim per wallet per endpoint', () => {
  it('claims are isolated per endpoint; release frees only that endpoint', () => {
    const db = freshDb();
    try {
      const trials = makeTrialsRepo(db);
      const payer = '0xabc0000000000000000000000000000000000001';
      expect(trials.claimed(payer, 'capture')).toBe(false);
      expect(trials.tryClaim(payer, 'capture')).toBe(true);
      expect(trials.tryClaim(payer, 'capture')).toBe(false);
      expect(trials.claimed(payer, 'capture')).toBe(true);
      expect(trials.claimed(payer, 'extract')).toBe(false);
      expect(trials.tryClaim(payer, 'extract')).toBe(true);
      expect(trials.claimedEndpoints(payer)).toEqual(['capture', 'extract']);
      expect(trials.count()).toBe(2);
      trials.release(payer, 'capture');
      expect(trials.claimed(payer, 'capture')).toBe(false);
      expect(trials.claimed(payer, 'extract')).toBe(true);
      expect(trials.count()).toBe(1);
    } finally {
      db.close();
    }
  });

  it('payer keys are case-insensitive', () => {
    const db = freshDb();
    try {
      const trials = makeTrialsRepo(db);
      expect(trials.tryClaim('0xABC0000000000000000000000000000000000001', 'audit')).toBe(true);
      expect(trials.claimed('0xabc0000000000000000000000000000000000001', 'audit')).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe('migrateTrialClaims — v1 (capture-only) rows survive as capture claims', () => {
  it('adds the endpoint column and preserves existing rows as capture claims', () => {
    const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE trial_claims (payer TEXT PRIMARY KEY, created_at TEXT NOT NULL)');
      db.exec("INSERT INTO trial_claims (payer, created_at) VALUES ('0xabc0000000000000000000000000000000000001', '2026-01-01T00:00:00.000Z')");
      migrateTrialClaims(db);
      const cols = db.prepare('PRAGMA table_info(trial_claims)').all() as Array<{ name: string }>;
      expect(cols.map((c) => c.name).sort()).toEqual(['created_at', 'endpoint', 'payer']);
      const trials = makeTrialsRepo(db as Db);
      expect(trials.claimed('0xabc0000000000000000000000000000000000001', 'capture')).toBe(true);
      expect(trials.claimed('0xabc0000000000000000000000000000000000001', 'extract')).toBe(false);
      expect(trials.count()).toBe(1);
      // Idempotent: a second run keeps the row and the new shape.
      migrateTrialClaims(db);
      expect(trials.count()).toBe(1);
    } finally {
      db.close();
    }
  });
});

describe('makeFaucetRepo — daily per-IP-hash budget', () => {
  it('counts uses per day and prunes past days', () => {
    const db = freshDb();
    try {
      const faucet = makeFaucetRepo(db);
      expect(faucet.usedToday('iphash1', '2026-09-22')).toBe(0);
      expect(faucet.record('iphash1', '2026-09-22')).toBe(1);
      expect(faucet.record('iphash1', '2026-09-22')).toBe(2);
      expect(faucet.usedToday('iphash1', '2026-09-22')).toBe(2);
      expect(faucet.usedToday('iphash1', '2026-09-23')).toBe(0);
      const rows = db.prepare('SELECT COUNT(*) AS n FROM faucet_days').get() as { n: number };
      expect(rows.n).toBe(0);
      expect(faucet.record('iphash1', '2026-09-23')).toBe(1);
      expect(FAUCET_DAILY_LIMIT).toBe(3);
    } finally {
      db.close();
    }
  });
});
