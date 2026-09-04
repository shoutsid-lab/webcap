import type { Db } from './index.js';

export interface InvoiceRow {
  readonly id: number;
  readonly pack: string;
  readonly chain: string;
  readonly usdc_contract: string;
  readonly usdc_address: string;
  readonly amount_usd: number;
  readonly usdc_amount: number;
  readonly recipient: string;
  readonly status: string;
  readonly created_at: string;
  readonly expires_at: string;
}

export interface NewInvoice {
  readonly pack: string;
  readonly chain: string;
  readonly usdc_contract: string;
  readonly usdc_address: string;
  readonly amount_usd: number;
  readonly usdc_amount: number;
  readonly recipient: string;
  readonly expires_at: string;
}

export interface InvoicesRepo {
  create(inv: NewInvoice): number;
  get(id: number): InvoiceRow | undefined;
  /** Set status to 'paid' and link any unlinked payment row for txHash. */
  markInvoicePaid(id: number, txHash: string): void;
  listOpenInvoices(): InvoiceRow[];
  /** First open invoice with the exact USDC amount (6-decimal units). */
  findOpenInvoiceByUsdcAmount(value: number): InvoiceRow | undefined;
}

const now = (): string => new Date().toISOString();

export function makeInvoicesRepo(db: Db): InvoicesRepo {
  const insert = db.prepare<
    [string, string, string, string, number, number, string, string, string],
    unknown
  >(
    `INSERT INTO invoices
       (pack, chain, usdc_contract, usdc_address, amount_usd, usdc_amount, recipient, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
  );
  const select = db.prepare<[number], InvoiceRow>(
    `SELECT id, pack, chain, usdc_contract, usdc_address, amount_usd, usdc_amount,
            recipient, status, created_at, expires_at
     FROM invoices WHERE id = ?`,
  );
  const markPaid = db.prepare<[number], unknown>(
    "UPDATE invoices SET status = 'paid' WHERE id = ? AND status = 'open'",
  );
  const linkPayment = db.prepare<[number, string], unknown>(
    'UPDATE payments SET invoice_id = ? WHERE tx_hash = ? AND invoice_id IS NULL',
  );
  const listOpen = db.prepare<[], InvoiceRow>(
    `SELECT id, pack, chain, usdc_contract, usdc_address, amount_usd, usdc_amount,
            recipient, status, created_at, expires_at
     FROM invoices WHERE status = 'open' ORDER BY id`,
  );
  const findByAmount = db.prepare<[number], InvoiceRow>(
    `SELECT id, pack, chain, usdc_contract, usdc_address, amount_usd, usdc_amount,
            recipient, status, created_at, expires_at
     FROM invoices WHERE status = 'open' AND usdc_amount = ? ORDER BY id LIMIT 1`,
  );

  return {
    create(inv: NewInvoice): number {
      const info = insert.run(
        inv.pack,
        inv.chain,
        inv.usdc_contract,
        inv.usdc_address,
        inv.amount_usd,
        inv.usdc_amount,
        inv.recipient,
        now(),
        inv.expires_at,
      );
      return Number(info.lastInsertRowid);
    },
    get(id: number): InvoiceRow | undefined {
      return select.get(id);
    },
    markInvoicePaid(id: number, txHash: string): void {
      const info = markPaid.run(id);
      if (info.changes === 0) throw new Error(`invoice ${id} not found or already settled`);
      linkPayment.run(id, txHash);
    },
    listOpenInvoices(): InvoiceRow[] {
      return listOpen.all();
    },
    findOpenInvoiceByUsdcAmount(value: number): InvoiceRow | undefined {
      return findByAmount.get(value);
    },
  };
}
