import type { Db } from '../db/index.js';
import { creditsForUsdc, USDC_UNITS_PER_CREDIT } from '../config.js';
import { makeCreditsRepo } from '../db/credits.js';
import { makeInvoicesRepo, type InvoiceRow } from '../db/invoices.js';
import { makePaymentsRepo } from '../db/payments.js';

export interface SettleInput {
  readonly db: Db;
  readonly invoice: InvoiceRow;
  readonly txHash: string;
  readonly logIndex: number;
  readonly fromAddr: string;
  readonly toAddr: string;
  readonly value: bigint;
  readonly block: number;
}

/**
 * Settle an invoice against a confirmed USDC Transfer, atomically: mark the
 * invoice paid, record the payment, and credit the invoice's account.
 * The grant is min(floor(paidUsdc * CREDITS_PER_USDC), invoice credits) —
 * the invoice is the offer, so overpayment never mints extra credits.
 * Idempotent — the UNIQUE(tx_hash, log_index) payment row is the dedup key,
 * so a replayed log grants nothing.
 *
 * Sender matching lives with the caller (poller): only a transfer FROM the
 * invoice's account address may settle it, so one customer's payment can
 * never credit another customer's invoice.
 */
export function settleInvoice(input: SettleInput): boolean {
  const { db, invoice, txHash, logIndex, fromAddr, toAddr, value, block } = input;
  const payments = makePaymentsRepo(db);
  const invoices = makeInvoicesRepo(db);
  const credits = makeCreditsRepo(db);
  const txn = db.transaction((): boolean => {
    const isNew = payments.recordPayment({ invoiceId: invoice.id, txHash, logIndex, fromAddr, toAddr, value: Number(value), block });
    if (!isNew) return false;
    invoices.markInvoicePaid(invoice.id, txHash);
    const invoiceCredits = Math.floor(invoice.usdc_amount / USDC_UNITS_PER_CREDIT);
    credits.grantCredits(invoice.account_id, Math.min(creditsForUsdc(value), invoiceCredits), 'payment_settled', txHash);
    return true;
  });
  return txn();
}
