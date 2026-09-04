import { describe, expect, it } from 'vitest';
import { AbiCoder, Contract, zeroPadValue, type LogParams } from 'ethers';
import { openDb } from '../../src/db/index.js';
import { makeAccountsRepo } from '../../src/db/accounts.js';
import { makeInvoicesRepo } from '../../src/db/invoices.js';
import { TRANSFER_TOPIC, usdcAbi } from '../../src/payment/erc20.js';
import { processPendingInvoices, type LogReader } from '../../src/payment/poller.js';
import { settleInvoice } from '../../src/payment/settle.js';

const USDC_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const MERCHANT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const CUSTOMER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const TX_HASH = `0x${'22'.repeat(32)}`;
const BLOCK_HASH = `0x${'11'.repeat(32)}`;

const usdc = new Contract(USDC_ADDRESS, usdcAbi);

function transferLog(value: bigint, logIndex: number): LogParams {
  return {
    address: USDC_ADDRESS,
    blockNumber: 10,
    blockHash: BLOCK_HASH,
    transactionHash: TX_HASH,
    transactionIndex: 0,
    index: logIndex,
    removed: false,
    topics: [TRANSFER_TOPIC, zeroPadValue(CUSTOMER.toLowerCase(), 32), zeroPadValue(MERCHANT.toLowerCase(), 32)],
    data: AbiCoder.defaultAbiCoder().encode(['uint256'], [value]),
  };
}

function makeLogReader(logs: LogParams[], latestBlock: number): LogReader {
  return {
    getBlockNumber: async () => latestBlock,
    getLogs: async () => logs,
  };
}

function makeDbFixture() {
  const db = openDb(':memory:');
  const accounts = makeAccountsRepo(db);
  const invoices = makeInvoicesRepo(db);
  const accountId = accounts.create(CUSTOMER);
  const invoiceId = invoices.create({
    account_id: accountId,
    pack: 'custom',
    chain: 'local',
    usdc_contract: USDC_ADDRESS,
    usdc_address: MERCHANT,
    amount_usd: 0.05,
    usdc_amount: 50_000,
    recipient: MERCHANT,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  });
  return { db, accounts, invoices, accountId, invoiceId };
}

describe('settle + poller (deterministic, fake chain reader)', () => {
  it('a 0.01 USDC transfer (< 0.05 required) does not settle the invoice', async () => {
    const fx = makeDbFixture();
    const settled = await processPendingInvoices({
      db: fx.db,
      provider: makeLogReader([transferLog(10_000n, 0)], 10),
      usdc,
      merchantAddress: MERCHANT,
      chain: 'local',
    });
    expect(settled).toBe(0);
    expect(fx.invoices.get(fx.invoiceId)?.status).toBe('open');
    expect(fx.accounts.getBalance(fx.accountId)).toBe(0);
    fx.db.close();
  });

  it('a 0.05 USDC transfer settles the invoice and grants floor(0.05 * 100) = 5 credits', async () => {
    const fx = makeDbFixture();
    const settled = await processPendingInvoices({
      db: fx.db,
      provider: makeLogReader([transferLog(50_000n, 0)], 10),
      usdc,
      merchantAddress: MERCHANT,
      chain: 'local',
    });
    expect(settled).toBe(1);
    expect(fx.invoices.get(fx.invoiceId)?.status).toBe('paid');
    expect(fx.accounts.getBalance(fx.accountId)).toBe(5);
    fx.db.close();
  });

  it('settleInvoice is idempotent: a replayed (txHash, logIndex) grants nothing extra', async () => {
    const fx = makeDbFixture();
    const invoice = fx.invoices.get(fx.invoiceId);
    if (invoice === undefined) throw new Error('invoice vanished after insert');
    const settle = (): boolean =>
      settleInvoice({
        db: fx.db,
        invoice,
        txHash: TX_HASH,
        logIndex: 0,
        fromAddr: CUSTOMER,
        toAddr: MERCHANT,
        value: 50_000n,
        block: 10,
      });
    expect(settle()).toBe(true);
    expect(settle()).toBe(false);
    expect(fx.accounts.getBalance(fx.accountId)).toBe(5);
    const count = fx.db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM payments').get();
    expect(count?.n).toBe(1);
    fx.db.close();
  });
});
