import { isAddress } from 'ethers';

export type ChainName = 'base-sepolia' | 'base' | 'local';
export type PackName = 'starter' | 'pro' | 'max';

export interface ChainConfig {
  readonly name: ChainName;
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly usdcContract: string;
  readonly explorer: string;
}

export interface CreditPack {
  readonly credits: number;
  readonly usd: number;
  /** USDC amount in 6-decimal units. */
  readonly usdc: number;
}

export interface WebcapConfig {
  readonly chain: ChainConfig;
  readonly port: number;
  readonly pollIntervalMs: number;
  readonly merchantPrivateKey: string;
  readonly dbPath: string;
}

const CHAINS: Record<ChainName, Omit<ChainConfig, 'name'>> = {
  'base-sepolia': {
    rpcUrl: 'https://sepolia.base.org',
    chainId: 84532,
    usdcContract: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    explorer: 'https://sepolia.basescan.org',
  },
  base: {
    rpcUrl: 'https://mainnet.base.org',
    chainId: 8453,
    usdcContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    explorer: 'https://basescan.org',
  },
  local: {
    rpcUrl: 'http://127.0.0.1:8545',
    chainId: 31337,
    // Replaced by LOCAL_USDC_CONTRACT at load time (required in local mode).
    usdcContract: '',
    explorer: '',
  },
};

export const PACKS: Record<PackName, CreditPack> = {
  starter: { credits: 100, usd: 0.5, usdc: 500_000 },
  pro: { credits: 1000, usd: 3.0, usdc: 3_000_000 },
  max: { credits: 10_000, usd: 12.0, usdc: 12_000_000 },
};

/** Look up a credit pack by name; throws on unknown names. */
export function getPack(name: string): CreditPack {
  if (name === 'starter' || name === 'pro' || name === 'max') return PACKS[name];
  throw new Error(`unknown pack: ${name}`);
}

export const CREDITS_PER_USDC = 100;
export const USDC_SCALE = 1_000_000;
export const USDC_UNITS_PER_CREDIT = USDC_SCALE / CREDITS_PER_USDC;
export const PRICE_PER_CREDIT = 1 / CREDITS_PER_USDC;
export const CAPTURE_COST_CREDITS = 1;

/** Credits granted for a settled USDC payment: floor(paidUsdc * CREDITS_PER_USDC). */
export function creditsForUsdc(usdcUnits: bigint): number {
  return Number(usdcUnits / BigInt(USDC_UNITS_PER_CREDIT));
}

/** 6-decimal USDC units required to buy `credits`. */
export function usdcUnitsForCredits(credits: number): number {
  return credits * USDC_UNITS_PER_CREDIT;
}

/** USDC (human units) required to buy `credits`. */
export function usdcForCredits(credits: number): number {
  return credits / CREDITS_PER_USDC;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`invalid numeric env value: ${raw}`);
  return value;
}

/** Parse and validate the webcap environment. Throws on invalid config. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): WebcapConfig {
  const rawChain = env.WEBCAP_CHAIN ?? 'base-sepolia';
  if (rawChain !== 'base-sepolia' && rawChain !== 'base' && rawChain !== 'local') {
    throw new Error(`unknown WEBCAP_CHAIN: ${rawChain}`);
  }
  const chainName: ChainName = rawChain;
  const base = CHAINS[chainName];

  let usdcContract = base.usdcContract;
  if (chainName === 'local') {
    const localUsdc = env.LOCAL_USDC_CONTRACT;
    if (localUsdc === undefined || localUsdc === '') {
      throw new Error('LOCAL_USDC_CONTRACT is required when WEBCAP_CHAIN=local');
    }
    if (!isAddress(localUsdc)) {
      throw new Error(`LOCAL_USDC_CONTRACT is not a valid address: ${localUsdc}`);
    }
    usdcContract = localUsdc;
  }

  return {
    chain: { name: chainName, rpcUrl: base.rpcUrl, chainId: base.chainId, usdcContract, explorer: base.explorer },
    port: parsePositiveInt(env.WEBCAP_PORT, 8080),
    pollIntervalMs: parsePositiveInt(env.POLL_INTERVAL_MS, 30_000),
    merchantPrivateKey: env.USDC_MERCHANT_PRIVATE_KEY ?? '',
    dbPath: env.WEBCAP_DB ?? 'data/webcap.db',
  };
}
