import type { Db } from './index.js';
import { nowIso } from '../util/time.js';

export interface PaymentInput {
  readonly invoiceId: number | null;
  readonly txHash: string;
  readonly logIndex: number;
  readonly fromAddr: string;
  readonly toAddr: string;
  readonly value: number;
  readonly block: number;
}

export interface PaymentsRepo {
  /** Idempotent insert; true when the row was new, false on duplicate. */
  recordPayment(input: PaymentInput): boolean;
  getPollState(chain: string): number;
  setPollState(chain: string, block: number): void;
}

export function makePaymentsRepo(db: Db): PaymentsRepo {
  const insert = db.prepare<
    [number | null, string, number, string, string, number, number, string],
    unknown
  >(
    `INSERT INTO payments
       (invoice_id, tx_hash, log_index, from_addr, to_addr, value, block, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tx_hash, log_index) DO NOTHING`,
  );
  const selectState = db.prepare<[string], { last_block: number }>(
    'SELECT last_block FROM poll_state WHERE chain = ?',
  );
  const upsertState = db.prepare<[string, number], unknown>(
    `INSERT INTO poll_state (chain, last_block) VALUES (?, ?)
     ON CONFLICT(chain) DO UPDATE SET last_block = excluded.last_block`,
  );

  return {
    recordPayment(input: PaymentInput): boolean {
      const info = insert.run(
        input.invoiceId,
        input.txHash,
        input.logIndex,
        input.fromAddr,
        input.toAddr,
        input.value,
        input.block,
        nowIso(),
      );
      return info.changes === 1;
    },
    getPollState(chain: string): number {
      const row = selectState.get(chain);
      return row === undefined ? 0 : row.last_block;
    },
    setPollState(chain: string, block: number): void {
      upsertState.run(chain, block);
    },
  };
}
