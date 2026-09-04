import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { openDb, type Db } from '../../src/db/index.js';
import { makeAccountsRepo } from '../../src/db/accounts.js';
import { makeCreditsRepo } from '../../src/db/credits.js';
import type { WebcapConfig } from '../../src/config.js';
import { buildApp } from '../../src/server/server.js';
import { capture } from '../../src/capture/pipeline.js';
import { closeBrowser } from '../../src/capture/browser.js';
import { ogMetadata } from '../../src/capture/og.js';
import { json, registerAccount } from './helpers/api.js';

const MERCHANT = '0x9fE46736679d2D9a65F0992bA200C5c1eFc82eEd';
const USDC = '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85';

describe('boot: app with real capture+og serves health, and register upserts accounts', () => {
  let dir: string;
  let db: Db;
  let app: FastifyInstance;
  let accounts: ReturnType<typeof makeAccountsRepo>;
  let credits: ReturnType<typeof makeCreditsRepo>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'webcap-boot-'));
    db = openDb(join(dir, 'boot.db'));
    accounts = makeAccountsRepo(db);
    credits = makeCreditsRepo(db);

    const config: WebcapConfig = {
      chain: { name: 'local', rpcUrl: 'http://127.0.0.1:8545', chainId: 31337, usdcContract: USDC, explorer: '' },
      chainId: 31337,
      rpcUrl: 'http://127.0.0.1:8545',
      usdcAddress: USDC,
      merchantAddress: MERCHANT,
      port: 0,
      pollIntervalMs: 5_000,
      merchantPrivateKey: '',
      dbPath: join(dir, 'boot.db'),
      x402Network: undefined,
      x402Asset: USDC,
      x402PayTo: MERCHANT,
      x402PriceUsdcUnits: 1_000,
      x402FacilitatorUrl: 'https://x402.org/facilitator',
    };
    app = buildApp({ db, config, capture, og: ogMetadata });
    await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await app.close();
    await closeBrowser();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('GET /v1/health reports ok with chain + credit model', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = json(res);
    expect(body.ok).toBe(true);
    expect(body.chainId).toBe(31337);
    expect(body.creditsPerUsdc).toBe(100);
    expect(body.pricePerCredit).toBe(0.01);
  });

  it('POST /v1/register creates an account + key, and repeats upsert to the same account', async () => {
    const address = '0x2f4d02e1661807158b63455d5752a362e08db32b';
    const first = await registerAccount(app, address);
    expect(first.status).toBe(201);
    expect(first.apiKey).toMatch(/^wc_live_[0-9a-f]{32}$/);
    expect(first.balance).toBe(0);

    const second = await registerAccount(app, address);
    expect(second.status).toBe(201);
    expect(second.apiKey).not.toBe(first.apiKey);

    // the route stores the EIP-55 checksummed form, so look it up as returned
    const accountId = accounts.findByAddress(first.address);
    expect(accountId).toBeTypeOf('number');
    if (accountId === undefined) throw new Error('register did not create an account');
    credits.grantCredits(accountId, 7, 'boot-test');

    for (const key of [first.apiKey, second.apiKey]) {
      const body = json(await app.inject({ method: 'GET', url: '/v1/account', headers: { authorization: `Bearer ${key}` } }));
      expect(body.balance).toBe(7);
    }
  });

  it('POST /v1/register rejects an invalid address with 422', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/register', payload: { address: 'not-an-address' } });
    expect(res.statusCode).toBe(422);
    expect(json(res).error).toBeDefined();
  });
});
