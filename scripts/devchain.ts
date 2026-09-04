/**
 * Local dev/test chain harness (anvil + MintableUSDC).
 *
 * Two modes, one file:
 *  - vitest globalSetup (default export): boots an anvil on 127.0.0.1:8545
 *    ONCE for the whole run, builds + deploys MintableUSDC from anvil
 *    account #0, mints 10000 USDC to customer (account #0) and a fresh
 *    random merchant, writes /tmp/webcap-test-chain.json, and returns a
 *    teardown that kills anvil.
 *  - manual (`npm run chain:up` / `tsx scripts/devchain.ts`): same bootstrap
 *    but with a DETACHED anvil that persists after the script exits, writing
 *    /tmp/webcap-chain.json. Idempotent: stale anvil on 8545 is killed first.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  Contract,
  ContractFactory,
  HDNodeWallet,
  JsonRpcProvider,
  Wallet,
  getIndexedAccountPath,
  type BaseWallet,
} from 'ethers';
import { contractMethod } from '../src/payment/erc20.js';

const ANVIL_PORT = 8545;
const RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;
const CHAIN_ID = 31337;
const MNEMONIC = 'test test test test test test test test test test test junk';
const ANVIL_ACCOUNT0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const MINT_AMOUNT = 10_000n * 1_000_000n; // 10000 USDC, 6 decimals

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT_PATH = join(PROJECT_ROOT, 'out', 'MintableUSDC.sol', 'MintableUSDC.json');

export interface ChainWallet {
  readonly address: string;
  readonly privateKey: string;
}

export interface ChainInfo {
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly usdcContract: string;
  readonly merchant: ChainWallet;
  readonly customer: ChainWallet;
}

const foundryBin = (name: string): string =>
  join(process.env.FOUNDRY_BIN ?? join(homedir(), '.foundry', 'bin'), name);

const sleep = (ms: number): Promise<void> => new Promise((resolveTimer) => setTimeout(resolveTimer, ms));

async function killStaleAnvil(): Promise<void> {
  try {
    execFileSync('pkill', ['-f', `anvil --port ${ANVIL_PORT}`], { stdio: 'ignore' });
    await sleep(300); // let the port be released
  } catch {
    // no stale anvil — fine
  }
}

function spawnAnvil(detached: boolean): ChildProcess {
  const child = spawn(
    foundryBin('anvil'),
    ['--port', String(ANVIL_PORT), '--silent', '--chain-id', String(CHAIN_ID)],
    { detached, stdio: 'ignore' },
  );
  // Unref so anvil never holds the vitest process open (teardown kills it).
  child.unref();
  return child;
}

async function waitForRpc(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      });
      const body = (await res.json()) as { result?: string };
      if (typeof body.result === 'string') return;
    } catch {
      // not up yet — retry
    }
    if (Date.now() >= deadline) throw new Error(`anvil not ready at ${RPC_URL} after ${timeoutMs}ms`);
    await sleep(250);
  }
}

function forgeBuild(): void {
  try {
    execFileSync(foundryBin('forge'), ['build'], { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    throw new Error(`forge build failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// cacheTimeout: -1 disables ethers' 250ms response cache (default since
// 6.17): anvil auto-mines instantly, so cached nonces would be stale and the
// second tx of a deploy->mint sequence would be rejected with "nonce too low".
const makeProvider = (url: string): JsonRpcProvider => new JsonRpcProvider(url, undefined, { cacheTimeout: -1 });

async function deployAndMint(): Promise<{ address: string; customer: BaseWallet; merchant: BaseWallet }> {
  const provider = makeProvider(RPC_URL);
  const customer = HDNodeWallet.fromPhrase(MNEMONIC, undefined, getIndexedAccountPath(0));
  if (customer.address.toLowerCase() !== ANVIL_ACCOUNT0.toLowerCase()) {
    throw new Error(`anvil account #0 derivation mismatch: ${customer.address}`);
  }
  const merchant = Wallet.createRandom();

  const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, 'utf8')) as { bytecode: { object: string } };
  const mintAbi = ['function mint(address to, uint256 amount)'];
  const factory = new ContractFactory(mintAbi, artifact.bytecode.object, customer.connect(provider));
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const target = contract.target;
  if (typeof target !== 'string') throw new Error('MintableUSDC deployment returned no address');

  const usdc = new Contract(target, mintAbi, customer.connect(provider));
  const mint = contractMethod(usdc, 'mint');
  await (await mint(customer.address, MINT_AMOUNT)).wait();
  await (await mint(merchant.address, MINT_AMOUNT)).wait();
  return { address: target, customer, merchant };
}

async function bootstrap(outFile: string, detached: boolean): Promise<{ info: ChainInfo; teardown: () => Promise<void> }> {
  await killStaleAnvil();
  const child = spawnAnvil(detached);
  let info: ChainInfo;
  try {
    await waitForRpc();
    forgeBuild();
    const { address, customer, merchant } = await deployAndMint();
    info = {
      rpcUrl: RPC_URL,
      chainId: CHAIN_ID,
      usdcContract: address,
      merchant: { address: merchant.address, privateKey: merchant.privateKey },
      customer: { address: customer.address, privateKey: customer.privateKey },
    };
    writeFileSync(outFile, JSON.stringify(info, null, 2) + '\n');
  } catch (err) {
    if (!detached) child.kill('SIGKILL');
    throw err;
  }
  return {
    info,
    teardown: async () => {
      try {
        child.kill('SIGKILL');
      } catch {
        // already dead
      }
    },
  };
}

// vitest globalSetup: run once per test run; teardown kills anvil.
export default async function setup(): Promise<() => Promise<void>> {
  const { teardown } = await bootstrap('/tmp/webcap-test-chain.json', false);
  return teardown;
}

async function manualRun(): Promise<void> {
  const { info } = await bootstrap('/tmp/webcap-chain.json', true);
  console.log('webcap local chain ready:');
  console.log(`  anvil:   ${info.rpcUrl} (persists; kill with: pkill -f "anvil --port ${ANVIL_PORT}")`);
  console.log(`  USDC:    ${info.usdcContract}`);
  console.log(`  merchant ${info.merchant.address}`);
  console.log(`  customer ${info.customer.address}`);
  console.log('  config written to /tmp/webcap-chain.json');
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  manualRun().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
