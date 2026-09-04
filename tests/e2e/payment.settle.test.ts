import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Contract, JsonRpcProvider, Wallet, type BaseWallet } from 'ethers';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../../src/db/index.js';
import { makeAccountsRepo, type AccountsRepo } from '../../src/db/accounts.js';
import { makeInvoicesRepo, type InvoicesRepo } from '../../src/db/invoices.js';
import { contractMethod, makeUsdcContract } from '../../src/payment/erc20.js';
import { processPendingInvoices } from '../../src/payment/poller.js';
import { loadTestChain, type TestChain } from '../helpers/chain.js';

const TRANSFER_ABI: readonly string[] = ['function transfer(address to, uint256 amount) returns (bool)'];

let chain: TestChain;
let dir: string;
let db: Db;
let provider: JsonRpcProvider;
let usdc: Contract;
let accounts: AccountsRepo;
let invoices: InvoicesRepo;
let merchant: BaseWallet;
let customer: Wallet;
let settledAccountId = 0;
let settledInvoiceId = 0;

beforeAll(() => {
  chain = loadTestChain();
  dir = mkdtempSync(join(tmpdir(), 'webcap-settle-'));
  db = openDb(join(dir, 'settle.db'));
  provider = new JsonRpcProvider(chain.rpcUrl, undefined, { cacheTimeout: -1 });
  usdc = makeUsdcContract(chain.rpcUrl, chain.usdcContract);
  accounts = makeAccountsRepo(db);
  invoices = makeInvoicesRepo(db);
  merchant = Wallet.createRandom();
  customer = new Wallet(chain.customer.privateKey, provider);
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createInvoice(usdcAmount: number, recipient: string, accountId: number): number {
  return invoices.create({
    account_id: accountId,
    pack: 'custom',
    chain: 'local',
    usdc_contract: chain.usdcContract,
    usdc_address: recipient,
    amount_usd: usdcAmount / 1_000_000,
    usdc_amount: usdcAmount,
    recipient,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  });
}

async function sendUsdc(amount: bigint, to: string): Promise<void> {
  const sender = new Contract(chain.usdcContract, TRANSFER_ABI, customer);
  const transfer = contractMethod(sender, 'transfer');
  await (await transfer(to, amount)).wait();
}

function paymentRowCount(invoiceId: number): number {
  const row = db.prepare<[number], { n: number }>('SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ?').get(invoiceId);
  return row?.n ?? 0;
}

describe('payment settle (anvil + MintableUSDC, real transfers)', () => {
  it('settles a 0.05 invoice from a real 0.05 USDC transfer and credits the account +5', async () => {
    settledAccountId = accounts.create(chain.customer.address);
    settledInvoiceId = createInvoice(50_000, merchant.address, settledAccountId);
    expect(invoices.get(settledInvoiceId)?.status).toBe('open');

    await sendUsdc(50_000n, merchant.address);

    const settled = await processPendingInvoices({ db, provider, usdc, merchantAddress: merchant.address, chain: 'local' });
    expect(settled).toBe(1);
    expect(invoices.get(settledInvoiceId)?.status).toBe('paid');
    expect(accounts.getBalance(settledAccountId)).toBe(5);
    expect(paymentRowCount(settledInvoiceId)).toBe(1);
  });

  it('is idempotent: a second poll run grants no extra credits and no new payment row', async () => {
    const settled = await processPendingInvoices({ db, provider, usdc, merchantAddress: merchant.address, chain: 'local' });
    expect(settled).toBe(0);
    expect(accounts.getBalance(settledAccountId)).toBe(5);
    expect(paymentRowCount(settledInvoiceId)).toBe(1);
  });

  it('does not settle when the transfer is below the invoice amount (0.01 < 0.05)', async () => {
    const secondMerchant = Wallet.createRandom();
    const accountId = accounts.create(chain.customer.address);
    const invoiceId = createInvoice(50_000, secondMerchant.address, accountId);

    await sendUsdc(10_000n, secondMerchant.address);

    const settled = await processPendingInvoices({ db, provider, usdc, merchantAddress: secondMerchant.address, chain: 'local' });
    expect(settled).toBe(0);
    expect(invoices.get(invoiceId)?.status).toBe('open');
    expect(accounts.getBalance(accountId)).toBe(0);
  });
});
