import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Contract, JsonRpcProvider, Wallet, type BaseWallet } from 'ethers';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { openDb, type Db } from '../../src/db/index.js';
import type { WebcapConfig } from '../../src/config.js';
import { buildApp } from '../../src/server/server.js';
import { capture } from '../../src/capture/pipeline.js';
import { closeBrowser } from '../../src/capture/browser.js';
import { ogMetadata } from '../../src/capture/og.js';
import { contractMethod, makeUsdcContract } from '../../src/payment/erc20.js';
import { processPendingInvoices } from '../../src/payment/poller.js';
import { loadTestChain, type TestChain } from '../helpers/chain.js';
import { json, registerAccount } from './helpers/api.js';

const TRANSFER_ABI: readonly string[] = ['function transfer(address to, uint256 amount) returns (bool)'];
const PAGE_HTML =
  '<!doctype html><html><head><title>S1 Loop Page</title></head><body><h1>paid capture</h1></body></html>';

describe('S1: full loop register -> invoice -> USDC pay -> settle -> real capture', () => {
  let chain: TestChain;
  let dir: string;
  let db: Db;
  let app: FastifyInstance;
  let provider: JsonRpcProvider;
  let usdc: Contract;
  let merchant: BaseWallet;
  let customer: Wallet;
  let server: Server;
  let fixtureUrl: string;
  let apiKey: string;

  beforeAll(async () => {
    chain = loadTestChain();
    dir = mkdtempSync(join(tmpdir(), 'webcap-s1-'));
    db = openDb(join(dir, 's1.db'));
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
      dbPath: join(dir, 's1.db'),
      x402Network: undefined,
      x402Asset: chain.usdcContract,
      x402PayTo: merchant.address,
      x402PriceUsdcUnits: 1_000,
      x402FacilitatorUrl: 'https://x402.org/facilitator',
    };
    app = buildApp({ db, config, capture, og: ogMetadata, captureAllowHosts: ['127.0.0.1'] });

    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(PAGE_HTML);
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('fixture server has no port');
    fixtureUrl = `http://127.0.0.1:${address.port}/`;

    await app.listen({ port: 0, host: '127.0.0.1' });
    const registered = await registerAccount(app, chain.customer.address);
    expect(registered.status).toBe(201);
    expect(registered.apiKey).toMatch(/^wc_live_[0-9a-f]{32}$/);
    expect(registered.balance).toBe(0);
    apiKey = registered.apiKey;
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((err) => (err !== undefined ? rejectClose(err) : resolveClose()));
    });
    await closeBrowser();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('invoice -> 1.0 USDC payment -> settle credits 100 -> real capture charges 1 and returns a PNG', async () => {
    const invoice = json(
      await app.inject({
        method: 'POST',
        url: '/v1/invoice',
        payload: { credits: 100 },
        headers: { authorization: `Bearer ${apiKey}` },
      }),
    );
    expect(invoice.requiredUsdc).toBe(1.0);
    expect(invoice.merchant).toBe(merchant.address);

    const sender = new Contract(chain.usdcContract, TRANSFER_ABI, customer);
    const transfer = contractMethod(sender, 'transfer');
    await (await transfer(merchant.address, 1_000_000n)).wait(); // 1.0 USDC

    const settled = await processPendingInvoices({ db, provider, usdc, merchantAddress: merchant.address, chain: 'local' });
    expect(settled).toBe(1);

    const account = json(
      await app.inject({ method: 'GET', url: '/v1/account', headers: { authorization: `Bearer ${apiKey}` } }),
    );
    expect(account.balance).toBe(100);

    const captured = json(
      await app.inject({
        method: 'POST',
        url: '/v1/capture',
        payload: { url: fixtureUrl, format: 'png' },
        headers: { authorization: `Bearer ${apiKey}` },
      }),
    );
    const artifact = captured.artifact as { format?: unknown; bytes?: unknown; data?: unknown };
    expect(artifact.format).toBe('png');
    expect(typeof artifact.data).toBe('string');
    expect(Buffer.from(String(artifact.data), 'base64').subarray(0, 4).toString('hex')).toBe('89504e47');
    expect(captured.creditsCharged).toBe(1);
    expect(captured.balance).toBe(99);

    const payment = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM payments').get();
    expect(payment?.n).toBe(1);
    const invoices = account.invoices as { status?: unknown }[];
    expect(invoices[0]?.status).toBe('paid');
  });
});
