import type { Db } from './index.js';
import { nowIso } from '../util/time.js';

/**
 * Canonical trial-claim message: the claimant personal_signs exactly this
 * string (lowercase hex address). Single source of truth — the route and the
 * agent docs must quote it verbatim.
 */
export function trialMessage(payerLower: string): string {
  return `Claim one free webcap trial capture for ${payerLower}`;
}

export interface TrialsRepo {
  claimed(payer: string): boolean;
  tryClaim(payer: string): boolean;
  release(payer: string): void;
  count(): number;
}

export function makeTrialsRepo(db: Db): TrialsRepo {
  const isClaimed = db.prepare<[string], { n: number }>(
    'SELECT COUNT(*) AS n FROM trial_claims WHERE payer = ?',
  );
  const insertClaim = db.prepare<[string, string], unknown>(
    'INSERT OR IGNORE INTO trial_claims (payer, created_at) VALUES (?, ?)',
  );
  const deleteClaim = db.prepare<[string], unknown>('DELETE FROM trial_claims WHERE payer = ?');
  const countClaims = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM trial_claims');
  const key = (payer: string): string => payer.toLowerCase();
  return {
    claimed(payer: string): boolean {
      return (isClaimed.get(key(payer))?.n ?? 0) > 0;
    },
    tryClaim(payer: string): boolean {
      const info = insertClaim.run(key(payer), nowIso()) as { changes: number };
      return info.changes === 1;
    },
    release(payer: string): void {
      deleteClaim.run(key(payer));
    },
    count(): number {
      return countClaims.get()?.n ?? 0;
    },
  };
}
