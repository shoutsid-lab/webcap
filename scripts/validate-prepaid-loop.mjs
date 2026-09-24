/**
 * Full prepaid-loop proof: register → invoice → REAL USDC transfer on a
 * local Anvil chain → poller settlement → credit-metered call with REAL
 * Chrome capture. No mocks, no stubs.
 *
 * Usage:
 *   npm run chain:up            # detached Anvil + /tmp/webcap-chain.json
 *   npm run build
 *   node scripts/validate-prepaid-loop.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';

const PORT = 18081;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = '/tmp/webcap-loop.db';

const steps = [];
function step(name, pass, detail) {
  steps.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!pass) {
    throw new Error(`loop failed at: ${name} (${detail})`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const chain = JSON.parse(readFileSync('/tmp/webcap-chain.json', 'utf8'));
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) {
    if (existsSync(f)) rmSync(f);
  }

  const server = spawn('node', ['dist/main.js'], {
    env: {
      ...process.env,
      WEBCAP_CHAIN: 'local',
      WEBCAP_PORT: String(PORT),
      WEBCAP_RPC_URL: chain.rpcUrl,
      WEBCAP_USDC_ADDRESS: chain.usdcContract,
      USDC_MERCHANT_PRIVATE_KEY: chain.merchant.privateKey,
      WEBCAP_DB: DB,
      WEBCAP_PUBLIC_BASE_URL: BASE,
      POLL_INTERVAL_MS: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const kill = () => {
    try {
      server.kill('SIGTERM');
    } catch {
      // already gone
    }
  };
  process.on('exit', kill);

  try {
    let healthy = false;
    for (let i = 0; i < 60 && !healthy; i++) {
      try {
        const r = await fetch(`${BASE}/v1/health`);
        healthy = r.status === 200;
      } catch {
        await sleep(1000);
      }
    }
    step('server boots on local chain', healthy, healthy ? 'health 200' : 'never healthy');

    // Register.
    const reg = await fetch(`${BASE}/v1/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: chain.customer.address }),
    });
    const regBody = await reg.json();
    step('register mints api key', reg.status === 201 && typeof regBody.apiKey === 'string', `status=${reg.status}`);
    const apiKey = regBody.apiKey;

    // Invoice a starter pack.
    const inv = await fetch(`${BASE}/v1/invoice`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ pack: 'starter' }),
    });
    const invBody = await inv.json();
    const okInv = inv.status === 201 && invBody.credits === 100 && invBody.requiredUsdc === 1 && invBody.pack === 'starter';
    step('invoice pack=starter → 100 credits / $1', okInv, `status=${inv.status} credits=${invBody.credits} usdc=${invBody.requiredUsdc}`);

    // Real USDC transfer on Anvil.
    const { Contract, JsonRpcProvider, Wallet } = await import('ethers');
    const { contractMethod } = await import('../dist/payment/erc20.js');
    const provider = new JsonRpcProvider(chain.rpcUrl);
    const customer = new Wallet(chain.customer.privateKey, provider);
    const usdc = new Contract(chain.usdcContract, ['function transfer(address to, uint256 value) returns (bool)'], customer);
    const transfer = contractMethod(usdc, 'transfer');
    const units = BigInt(Math.round(invBody.requiredUsdc * 1_000_000));
    const tx = await transfer(invBody.merchant, units);
    await tx.wait();
    step('USDC transfer mines', true, `tx=${String(tx.hash).slice(0, 18)}… value=${units}`);

    // Poller settlement → balance.
    let balance = 0;
    for (let i = 0; i < 60 && balance !== 100; i++) {
      await sleep(2000);
      const acc = await fetch(`${BASE}/v1/account`, { headers: { authorization: `Bearer ${apiKey}` } });
      balance = (await acc.json()).balance;
    }
    step('poller settles → 100 credits', balance === 100, `balance=${balance}`);

    // Credit-metered call with real capture.
    const ext = await fetch(`${BASE}/v1/extract`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ url: 'https://example.com/' }),
    });
    const extBody = await ext.json();
    const words = extBody.results?.[0]?.data?.wordCount ?? 0;
    step('credit extract 200 (real Chrome)', ext.status === 200 && words > 0, `status=${ext.status} words=${words} charged=${extBody.creditsCharged}`);

    const after = await (await fetch(`${BASE}/v1/account`, { headers: { authorization: `Bearer ${apiKey}` } })).json();
    step('balance 99 after one call', after.balance === 99, `balance=${after.balance}`);
  } finally {
    kill();
    await sleep(1000);
    for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) {
      try {
        if (existsSync(f)) rmSync(f);
      } catch {
        // best effort
      }
    }
  }

  console.log(`\n${steps.length}/${steps.length} loop steps passed — the prepaid machine works end to end`);
}

await main().catch((err) => {
  console.error(`LOOP FAILED: ${err.message}`);
  process.exitCode = 1;
});
