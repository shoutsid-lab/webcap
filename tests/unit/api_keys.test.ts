import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { makeAccountsRepo } from '../../src/db/accounts.js';
import { makeApiKeysRepo } from '../../src/db/api_keys.js';
import { makeInvoicesRepo } from '../../src/db/invoices.js';
import { generateApiKey, hashKey } from '../../src/util/keys.js';

const USDC = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const ADDR_A = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const ADDR_B = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

describe('api_keys repo', () => {
  it('finds a live key by hash and joins the owning account', () => {
    const db = openDb(':memory:');
    const accounts = makeAccountsRepo(db);
    const keys = makeApiKeysRepo(db);
    const accountId = accounts.create(ADDR_A);
    const key = generateApiKey();
    const keyId = keys.create(accountId, hashKey(key));

    const found = keys.findLiveByHash(hashKey(key));
    expect(found?.key.id).toBe(keyId);
    expect(found?.account.id).toBe(accountId);
    expect(found?.account.address).toBe(ADDR_A);
    expect(keys.findLiveByHash(hashKey('wc_live_0000000000000000000000000000dead'))).toBeUndefined();
    db.close();
  });

  it('account create stores the customer address, defaulting to empty', () => {
    const db = openDb(':memory:');
    const accounts = makeAccountsRepo(db);
    const withAddress = accounts.create(ADDR_B);
    const without = accounts.create();
    expect(accounts.get(withAddress)?.address).toBe(ADDR_B);
    expect(accounts.get(without)?.address).toBe('');
    db.close();
  });

  it('invoice records its account and listByAccount returns newest first', () => {
    const db = openDb(':memory:');
    const accounts = makeAccountsRepo(db);
    const invoices = makeInvoicesRepo(db);
    const a = accounts.create(ADDR_A);
    const b = accounts.create(ADDR_B);
    const make = (accountId: number): number =>
      invoices.create({
        account_id: accountId,
        pack: 'custom',
        chain: 'local',
        usdc_contract: USDC,
        usdc_address: ADDR_B,
        amount_usd: 1,
        usdc_amount: 1_000_000,
        recipient: ADDR_B,
        expires_at: '2026-12-01T00:00:00.000Z',
      });
    const i1 = make(a);
    make(b);
    const i3 = make(a);

    const listA = invoices.listByAccount(a);
    expect(listA.map((row) => row.id)).toEqual([i3, i1]);
    expect(listA.every((row) => row.account_id === a)).toBe(true);
    db.close();
  });
});
