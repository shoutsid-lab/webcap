import type { Db } from './index.js';
import { nowIso } from '../util/time.js';

/**
 * Trial product surface: one free trial per wallet per endpoint. 'video' is
 * deliberately excluded — scroll-capture video burns an order of magnitude
 * more browser compute than a PNG, so it stays paid-only (the capture trial
 * is its free sample).
 */
export const TRIAL_ENDPOINTS = ['capture', 'extract', 'audit', 'map-lite', 'analyze'] as const;
export type TrialEndpoint = (typeof TRIAL_ENDPOINTS)[number];

export function isTrialEndpoint(value: unknown): value is TrialEndpoint {
  return typeof value === 'string' && (TRIAL_ENDPOINTS as readonly string[]).includes(value);
}

/**
 * Canonical trial-claim message for an endpoint: the claimant personal_signs
 * exactly this string (lowercase hex address). Single source of truth — the
 * routes and the agent docs must quote it verbatim. The message binds the
 * endpoint so a signature for one trial cannot be replayed for another.
 */
export function trialMessageFor(endpoint: TrialEndpoint, payerLower: string): string {
  return `Claim one free webcap trial ${endpoint} for ${payerLower}`;
}

/**
 * Legacy capture-only message (pre-per-endpoint trials). Still accepted for
 * the capture trial so signatures minted against the old docs keep working.
 */
export function trialMessage(payerLower: string): string {
  return `Claim one free webcap trial capture for ${payerLower}`;
}

export interface TrialsRepo {
  claimed(payer: string, endpoint: TrialEndpoint): boolean;
  claimedEndpoints(payer: string): TrialEndpoint[];
  tryClaim(payer: string, endpoint: TrialEndpoint): boolean;
  release(payer: string, endpoint: TrialEndpoint): void;
  count(): number;
}

export function makeTrialsRepo(db: Db): TrialsRepo {
  const isClaimed = db.prepare<[string, string], { n: number }>(
    'SELECT COUNT(*) AS n FROM trial_claims WHERE payer = ? AND endpoint = ?',
  );
  const listClaimed = db.prepare<[string], { endpoint: string }>(
    'SELECT endpoint FROM trial_claims WHERE payer = ?',
  );
  const insertClaim = db.prepare<[string, string, string], unknown>(
    'INSERT OR IGNORE INTO trial_claims (payer, endpoint, created_at) VALUES (?, ?, ?)',
  );
  const deleteClaim = db.prepare<[string, string], unknown>(
    'DELETE FROM trial_claims WHERE payer = ? AND endpoint = ?',
  );
  const countClaims = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM trial_claims');
  const key = (payer: string): string => payer.toLowerCase();
  return {
    claimed(payer: string, endpoint: TrialEndpoint): boolean {
      return (isClaimed.get(key(payer), endpoint)?.n ?? 0) > 0;
    },
    claimedEndpoints(payer: string): TrialEndpoint[] {
      return listClaimed.all(key(payer)).map((r) => r.endpoint).filter(isTrialEndpoint);
    },
    tryClaim(payer: string, endpoint: TrialEndpoint): boolean {
      const info = insertClaim.run(key(payer), endpoint, nowIso()) as { changes: number };
      return info.changes === 1;
    },
    release(payer: string, endpoint: TrialEndpoint): void {
      deleteClaim.run(key(payer), endpoint);
    },
    count(): number {
      return countClaims.get()?.n ?? 0;
    },
  };
}

/** Daily no-wallet faucet budget: at most FAUCET_DAILY_LIMIT thumbnails per IP-hash per UTC day. */
export const FAUCET_DAILY_LIMIT = 3;

export interface FaucetRepo {
  /** Today's used count for this IP hash (prunes past days as a side effect). */
  usedToday(ipHash: string, today: string): number;
  /** Record one faucet use; returns the new today-count. */
  record(ipHash: string, today: string): number;
}

export function makeFaucetRepo(db: Db): FaucetRepo {
  const getCount = db.prepare<[string, string], { count: number }>(
    'SELECT count FROM faucet_days WHERE ip_hash = ? AND day = ?',
  );
  const upsert = db.prepare<[string, string], unknown>(
    'INSERT INTO faucet_days (ip_hash, day, count) VALUES (?, ?, 1) ' +
      'ON CONFLICT (ip_hash, day) DO UPDATE SET count = count + 1',
  );
  const prune = db.prepare<[string], unknown>('DELETE FROM faucet_days WHERE day < ?');
  return {
    usedToday(ipHash: string, today: string): number {
      prune.run(today);
      return getCount.get(ipHash, today)?.count ?? 0;
    },
    record(ipHash: string, today: string): number {
      prune.run(today);
      upsert.run(ipHash, today);
      return getCount.get(ipHash, today)?.count ?? 0;
    },
  };
}
