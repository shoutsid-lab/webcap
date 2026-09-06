import type { Db } from './index.js';
import { makeAccountsRepo } from './accounts.js';
import { nowIso } from '../util/time.js';

export interface LedgerRow {
  readonly id: number;
  readonly account_id: number;
  readonly delta: number;
  readonly reason: string;
  readonly ref_id: string | null;
  readonly created_at: string;
}

export interface CreditsRepo {
  /** Ledger insert + balance update in one transaction. */
  grantCredits(accountId: number, delta: number, reason: string, refId?: string): void;
  /** Atomic 1-credit spend; true when a credit was consumed. */
  recordCharge(accountId: number): boolean;
  getLedger(accountId: number): LedgerRow[];
}

export function makeCreditsRepo(db: Db): CreditsRepo {
  const accounts = makeAccountsRepo(db);
  const insertLedger = db.prepare<[number, number, string, string | null, string], unknown>(
    'INSERT INTO credits_ledger (account_id, delta, reason, ref_id, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const updateBalance = db.prepare<[number, number], unknown>(
    'UPDATE accounts SET credits = credits + ? WHERE id = ?',
  );
  const selectLedger = db.prepare<[number], LedgerRow>(
    'SELECT id, account_id, delta, reason, ref_id, created_at FROM credits_ledger WHERE account_id = ? ORDER BY id',
  );

  const grantTxn = db.transaction(
    (accountId: number, delta: number, reason: string, refId: string | null): void => {
      insertLedger.run(accountId, delta, reason, refId, nowIso());
      updateBalance.run(delta, accountId);
    },
  );

  return {
    grantCredits(accountId, delta, reason, refId) {
      grantTxn(accountId, delta, reason, refId ?? null);
    },
    recordCharge(accountId: number): boolean {
      return accounts.spendOne(accountId);
    },
    getLedger(accountId: number): LedgerRow[] {
      return selectLedger.all(accountId);
    },
  };
}
