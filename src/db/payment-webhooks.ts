import type { Db } from './index.js';
import { nowIso } from '../util/time.js';

export interface PaymentWebhookRow {
  readonly id: number;
  readonly account_id: number;
  readonly url: string;
  readonly secret: string;
  readonly events: string;
  readonly active: number;
  readonly created_at: string;
}

export interface PaymentWebhooksRepo {
  /** Register a new payment webhook for an account. */
  register(accountId: number, url: string, secret: string): number;
  /** List all active webhooks for an account. */
  listByAccount(accountId: number): PaymentWebhookRow[];
  /** Get a single webhook by id (owner-checked). */
  get(id: number, accountId: number): PaymentWebhookRow | undefined;
  /** Deactivate a webhook (soft delete). */
  deactivate(id: number, accountId: number): boolean;
  /** Get all active webhooks (for firing on payment events). */
  listActive(): PaymentWebhookRow[];
}

export function makePaymentWebhooksRepo(db: Db): PaymentWebhooksRepo {
  const insert = db.prepare<[number, string, string, string, string], unknown>(
    `INSERT INTO payment_webhooks (account_id, url, secret, events, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const listByAccount = db.prepare<[number], PaymentWebhookRow>(
    `SELECT * FROM payment_webhooks WHERE account_id = ? AND active = 1 ORDER BY created_at DESC`,
  );
  const getById = db.prepare<[number, number], PaymentWebhookRow>(
    `SELECT * FROM payment_webhooks WHERE id = ? AND account_id = ? AND active = 1`,
  );
  const deactivate = db.prepare<[number, number], unknown>(
    `UPDATE payment_webhooks SET active = 0 WHERE id = ? AND account_id = ?`,
  );
  const listActive = db.prepare<[], PaymentWebhookRow>(
    `SELECT * FROM payment_webhooks WHERE active = 1`,
  );

  return {
    register(accountId: number, url: string, secret: string): number {
      const result = insert.run(accountId, url, secret, 'payment.settled', nowIso());
      return Number(result.lastInsertRowid);
    },
    listByAccount(accountId: number): PaymentWebhookRow[] {
      return listByAccount.all(accountId);
    },
    get(id: number, accountId: number): PaymentWebhookRow | undefined {
      return getById.get(id, accountId);
    },
    deactivate(id: number, accountId: number): boolean {
      const result = deactivate.run(id, accountId);
      return result.changes > 0;
    },
    listActive(): PaymentWebhookRow[] {
      return listActive.all();
    },
  };
}
