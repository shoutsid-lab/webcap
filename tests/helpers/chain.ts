import { readFileSync } from 'node:fs';

export interface ChainWallet {
  readonly address: string;
  readonly privateKey: string;
}

export interface TestChain {
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly usdcContract: string;
  readonly merchant: ChainWallet;
  readonly customer: ChainWallet;
}

const CHAIN_FILE = '/tmp/webcap-test-chain.json';

function isWallet(value: unknown): value is ChainWallet {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.address === 'string' && typeof v.privateKey === 'string';
}

function isChainInfo(value: unknown): value is TestChain {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.rpcUrl === 'string' &&
    typeof v.chainId === 'number' &&
    typeof v.usdcContract === 'string' &&
    isWallet(v.merchant) &&
    isWallet(v.customer)
  );
}

/**
 * Read the chain info written by the vitest globalSetup (scripts/devchain.ts).
 * e2e tests call this in beforeAll; throws if the harness did not run.
 */
export function loadTestChain(): TestChain {
  let raw: string;
  try {
    raw = readFileSync(CHAIN_FILE, 'utf8');
  } catch {
    throw new Error(`test chain config not found at ${CHAIN_FILE} — the vitest globalSetup must have run first`);
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isChainInfo(parsed)) throw new Error(`malformed test chain config at ${CHAIN_FILE}`);
  return parsed;
}
