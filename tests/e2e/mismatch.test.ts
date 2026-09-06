import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Contract, JsonRpcProvider, Wallet, type BaseWallet } from 'ethers';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { openDb, type Db } from '../../src/db/index.js';
import { makeArtifactRepo } from '../../src/db/artifacts.js';
import type { WebcapConfig } from '../../src/config.js';
import { buildApp } from '../../src/server/server.js';
import { capture, captureStructured } from '../../src/capture/pipeline.js';
import { ogMetadata } from '../../src/capture/og.js';
import { contractMethod, makeUsdcContract } from '../../src/payment/erc20.js';
import { processPendingInvoices } from '../../src/payment/poller.js';
import { loadTestChain, type TestChain } from '../helpers/chain.js';
import { json, registerAccount } from './helpers/api.js';

const TRANSFER_ABI: readonly string[] = ['function transfer(address to, uint256 amount) returns (bool)'];

describe('S4: underpayment does not settle and does not unlock capture', () => {
  let chain: TestChain;
  let dir: string;
  let db: Db;
  let app: FastifyInstance;
  let provider: JsonRpcProvider;
  let usdc: Contract;
  let merchant: BaseWallet;
  let customer: Wallet;
  let apiKey: string;

  beforeAll(async () => {
    chain = loadTestChain();
    dir = mkdtempSync(join(tmpdir(), 'webcap-s4-'));
    db = openDb(join(dir, 's4.db'));
    merchant = Wallet.createRandom();
    provider = new JsonRpcProvider(chain.rpcUrl, undefined, { cacheTimeout: -1 });
    customer = new Wallet(chain.customer.privateKey, provider);
    usdc = makeUsdcContract(chain.rpcUrl, chain.usdcContract);

    const config: WebcapConfig = {
      chain: { name: 'local', rpcUrl: chain.rpcUrl, chainId: 31337, usdcContract: chain.usdcContract, explorer: '' },
      chainId: 31337,
      rpcUrl: chain.rpcUrl,
      usdcAddress: chain.usdcContract,
      merchantAddress: merchant.address,
      port: 0,
      pollIntervalMs: 5_000,
      merchantPrivateKey: merchant.privateKey,
      dbPath: join(dir, 's4.db'),
      x402Network: undefined,
      x402Asset: chain.usdcContract,
      x402PayTo: merchant.address,
      x402PriceUsdcUnits: 1_000,
      x402ExtractPriceUsdcUnits: 10_000,
      x402AuditPriceUsdcUnits: 2_000,
      computeCostUsdcUnitsPerRequest: 200,
      modelApiBaseUrl: '',
      modelApiKey: '',
      modelName: '',
      x402FacilitatorUrl: 'https://x402.org/facilitator',
      publicBaseUrl: 'http://localhost:8080',
      cdpApiKey: undefined,
    };
    app = buildApp({ db, config, capture, captureStructured, og: ogMetadata, artifacts: makeArtifactRepo(db) });

    await app.listen({ port: 0, host: '127.0.0.1' });
    const registered = await registerAccount(app, chain.customer.address);
    expect(registered.status).toBe(201);
    apiKey = registered.apiKey;
  });

  afterAll(async () => {
    await app.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('0.5 USDC < 1.0 required: invoice stays open, balance 0, capture -> 402', async () => {
    const invoice = json(
      await app.inject({
        method: 'POST',
        url: '/v1/invoice',
        payload: { credits: 100 },
        headers: { authorization: `Bearer ${apiKey}` },
      }),
    );
    expect(invoice.requiredUsdc).toBe(1.0);
    const invoiceId = Number(invoice.invoiceId);
    expect(Number.isFinite(invoiceId)).toBe(true);

    const sender = new Contract(chain.usdcContract, TRANSFER_ABI, customer);
    const transfer = contractMethod(sender, 'transfer');
    await (await transfer(merchant.address, 500_000n)).wait(); // 0.5 USDC < 1.0 required

    const settled = await processPendingInvoices({ db, provider, usdc, merchantAddress: merchant.address, chain: 'local' });
    expect(settled).toBe(0);

    const row = db.prepare<[number], { status: string }>('SELECT status FROM invoices WHERE id = ?').get(invoiceId);
    expect(row?.status).toBe('open');

    const account = json(
      await app.inject({ method: 'GET', url: '/v1/account', headers: { authorization: `Bearer ${apiKey}` } }),
    );
    expect(account.balance).toBe(0);

    const captured = await app.inject({
      method: 'POST',
      url: '/v1/capture',
      payload: { url: 'https://example.com', format: 'png' },
      headers: { authorization: `Bearer ${apiKey}` },
    });
    expect(captured.statusCode).toBe(402);
    const body = json(captured);
    expect((body.error as { code?: unknown }).code).toBe('insufficient_credits');
  });
});
