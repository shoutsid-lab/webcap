import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { makeAccountsRepo } from '../../src/db/accounts.js';
import { makeCreditsRepo } from '../../src/db/credits.js';
import { makeInvoicesRepo, type NewInvoice } from '../../src/db/invoices.js';
import { makePaymentsRepo, type PaymentInput } from '../../src/db/payments.js';

function sampleInvoice(over: Partial<NewInvoice> = {}): NewInvoice {
  return {
    pack: 'starter',
    chain: 'local',
    usdc_contract: `0x${'11'.repeat(20)}`,
    usdc_address: `0x${'22'.repeat(20)}`,
    amount_usd: 0.5,
    usdc_amount: 500_000,
    recipient: `0x${'33'.repeat(20)}`,
    expires_at: '2026-12-31T00:00:00.000Z',
    ...over,
  };
}

describe('db: accounts + credits', () => {
  it('new account starts with zero balance', () => {
    const db = openDb(':memory:');
    const accounts = makeAccountsRepo(db);
    const id = accounts.create();
    expect(accounts.getBalance(id)).toBe(0);
    expect(accounts.get(id)).toMatchObject({ id, credits: 0 });
    db.close();
  });

  it('grantCredits adds to the balance and writes a ledger row', () => {
    const db = openDb(':memory:');
    const accounts = makeAccountsRepo(db);
    const credits = makeCreditsRepo(db);
    const id = accounts.create();
    credits.grantCredits(id, 100, 'purchase', 'inv_1');
    expect(accounts.getBalance(id)).toBe(100);
    const rows = credits.getLedger(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ account_id: id, delta: 100, reason: 'purchase', ref_id: 'inv_1' });
    db.close();
  });

  it('spendOne decrements the balance and writes a capture_charged ledger row', () => {
    const db = openDb(':memory:');
    const accounts = makeAccountsRepo(db);
    const credits = makeCreditsRepo(db);
    const id = accounts.create();
    credits.grantCredits(id, 5, 'purchase', 'inv_1');
    expect(accounts.spendOne(id)).toBe(true);
    expect(accounts.getBalance(id)).toBe(4);
    const charged = credits.getLedger(id).filter((row) => row.reason === 'capture_charged');
    expect(charged).toHaveLength(1);
    expect(charged[0]?.delta).toBe(-1);
    db.close();
  });

  it('spendOne at zero balance fails and leaves the balance unchanged', () => {
    const db = openDb(':memory:');
    const accounts = makeAccountsRepo(db);
    const id = accounts.create();
    expect(accounts.spendOne(id)).toBe(false);
    expect(accounts.getBalance(id)).toBe(0);
    expect(makeCreditsRepo(db).getLedger(id)).toHaveLength(0);
    db.close();
  });

  it('exactly one of two consecutive spends succeeds on a balance of 1', () => {
    const db = openDb(':memory:');
    const accounts = makeAccountsRepo(db);
    const credits = makeCreditsRepo(db);
    const id = accounts.create();
    credits.grantCredits(id, 1, 'purchase', 'inv_1');
    const results = [credits.recordCharge(id), credits.recordCharge(id)];
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(accounts.getBalance(id)).toBe(0);
    const charged = credits.getLedger(id).filter((row) => row.reason === 'capture_charged');
    expect(charged).toHaveLength(1);
    db.close();
  });
});

describe('db: invoices', () => {
  it('create/get round-trips an open invoice', () => {
    const db = openDb(':memory:');
    const invoices = makeInvoicesRepo(db);
    const id = invoices.create(sampleInvoice());
    expect(invoices.get(id)).toMatchObject({ pack: 'starter', status: 'open', usdc_amount: 500_000 });
    db.close();
  });

  it('markInvoicePaid flips the status and closes the invoice', () => {
    const db = openDb(':memory:');
    const invoices = makeInvoicesRepo(db);
    const id = invoices.create(sampleInvoice());
    invoices.markInvoicePaid(id, '0xabc123');
    expect(invoices.get(id)?.status).toBe('paid');
    expect(invoices.listOpenInvoices()).toHaveLength(0);
    db.close();
  });

  it('findOpenInvoiceByUsdcAmount matches by exact amount and skips paid invoices', () => {
    const db = openDb(':memory:');
    const invoices = makeInvoicesRepo(db);
    const starterId = invoices.create(sampleInvoice());
    const proId = invoices.create(sampleInvoice({ pack: 'pro', usdc_amount: 3_000_000 }));
    expect(invoices.findOpenInvoiceByUsdcAmount(3_000_000)?.id).toBe(proId);
    expect(invoices.findOpenInvoiceByUsdcAmount(500_000)?.id).toBe(starterId);
    expect(invoices.findOpenInvoiceByUsdcAmount(999)).toBeUndefined();
    invoices.markInvoicePaid(proId, '0xdef456');
    expect(invoices.findOpenInvoiceByUsdcAmount(3_000_000)).toBeUndefined();
    db.close();
  });
});

describe('db: payments + poll state', () => {
  it('recordPayment is idempotent on (tx_hash, log_index)', () => {
    const db = openDb(':memory:');
    const payments = makePaymentsRepo(db);
    const input: PaymentInput = {
      invoiceId: null,
      txHash: `0x${'ab'.repeat(32)}`,
      logIndex: 7,
      fromAddr: `0x${'ff'.repeat(20)}`,
      toAddr: `0x${'ee'.repeat(20)}`,
      value: 500_000,
      block: 12,
    };
    expect(payments.recordPayment(input)).toBe(true);
    expect(payments.recordPayment(input)).toBe(false);
    const count = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM payments').get();
    expect(count?.n).toBe(1);
    db.close();
  });

  it('poll state round-trips and defaults to 0', () => {
    const db = openDb(':memory:');
    const payments = makePaymentsRepo(db);
    expect(payments.getPollState('local')).toBe(0);
    payments.setPollState('local', 12345);
    expect(payments.getPollState('local')).toBe(12345);
    payments.setPollState('local', 12346);
    expect(payments.getPollState('local')).toBe(12346);
    db.close();
  });
});
