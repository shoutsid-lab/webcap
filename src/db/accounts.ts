import type { Db } from './index.js';

export interface AccountRow {
  readonly id: number;
  readonly credits: number;
  readonly created_at: string;
}

export interface AccountsRepo {
  /** Create an account with 0 credits; returns its id. */
  create(): number;
  get(id: number): AccountRow | undefined;
  getBalance(id: number): number;
  /**
   * Atomically spend exactly one credit, writing a 'capture_charged' ledger
   * row in the same transaction. The guarded UPDATE (`credits >= 1`) is the
   * no-double-charge guarantee: at most one caller ever sees changes() === 1.
   * Returns true when a credit was spent, false when the balance is 0.
   */
  spendOne(accountId: number): boolean;
}

const now = (): string => new Date().toISOString();

export function makeAccountsRepo(db: Db): AccountsRepo {
  const insertAccount = db.prepare<[string], unknown>(
    'INSERT INTO accounts (credits, created_at) VALUES (0, ?)',
  );
  const selectAccount = db.prepare<[number], AccountRow>(
    'SELECT id, credits, created_at FROM accounts WHERE id = ?',
  );
  const selectBalance = db.prepare<[number], { credits: number }>(
    'SELECT credits FROM accounts WHERE id = ?',
  );
  const spendCredit = db.prepare<[number], unknown>(
    'UPDATE accounts SET credits = credits - 1 WHERE id = ? AND credits >= 1',
  );
  const insertCharge = db.prepare<[number, string, string], unknown>(
    "INSERT INTO credits_ledger (account_id, delta, reason, ref_id, created_at) VALUES (?, -1, ?, NULL, ?)",
  );

  // The guarded UPDATE and its ledger row commit together or not at all.
  const spendTxn = db.transaction((accountId: number): boolean => {
    const info = spendCredit.run(accountId);
    if (info.changes === 1) {
      insertCharge.run(accountId, 'capture_charged', now());
    }
    return info.changes === 1;
  });

  return {
    create(): number {
      const info = insertAccount.run(now());
      return Number(info.lastInsertRowid);
    },
    get(id: number): AccountRow | undefined {
      return selectAccount.get(id);
    },
    getBalance(id: number): number {
      const row = selectBalance.get(id);
      if (row === undefined) throw new Error(`unknown account: ${id}`);
      return row.credits;
    },
    spendOne(accountId: number): boolean {
      return spendTxn(accountId);
    },
  };
}
