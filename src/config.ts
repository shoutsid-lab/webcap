import { isAddress, Wallet } from 'ethers';

export type ChainName = 'base-sepolia' | 'base' | 'local';
export type PackName = 'starter' | 'pro' | 'max';
/** CAIP-2 network ids for the x402 wire. `undefined` = x402 disabled. */
export type X402Network = 'eip155:84532' | 'eip155:8453';

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
  /** Denormalized run fields: what main.ts needs without digging into `chain`. */
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly usdcAddress: string;
  readonly merchantAddress: string;
  readonly port: number;
  readonly pollIntervalMs: number;
  readonly merchantPrivateKey: string;
  readonly dbPath: string;
  /** x402 CAIP-2 network; undefined when the chain has no real USDC (local). */
  readonly x402Network: X402Network | undefined;
  /** ERC-20 asset paid on the x402 route (default: chain USDC). */
  readonly x402Asset: string;
  /** x402 recipient address (default: merchant address). */
  readonly x402PayTo: string;
  /** x402 per-capture price in atomic 6-decimal USDC units. */
  readonly x402PriceUsdcUnits: number;
  /** Facilitator that verifies + settles x402 payments (gasless payer). */
  readonly x402FacilitatorUrl: string;
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

/** x402 only works on chains with a real USDC deploy; local anvil is excluded. */
export const X402_NETWORKS: Record<Exclude<ChainName, 'local'>, X402Network> = {
  'base-sepolia': 'eip155:84532',
  base: 'eip155:8453',
};

export const DEFAULT_X402_FACILITATOR_URL = 'https://x402.org/facilitator';
export const DEFAULT_X402_PRICE_USDC_UNITS = 1_000; // $0.001 in 6-decimal atomic units

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

/** WEBCAP_X402_PRICE_USDC (human USD, e.g. "0.001") -> atomic 6-decimal units. */
function parseX402PriceUsdc(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_X402_PRICE_USDC_UNITS;
  const usd = Number(raw);
  if (!Number.isFinite(usd) || usd <= 0) throw new Error(`invalid WEBCAP_X402_PRICE_USDC: ${raw}`);
  const units = Math.round(usd * USDC_SCALE);
  if (units < 1) throw new Error(`WEBCAP_X402_PRICE_USDC too small (min 1 atomic unit): ${raw}`);
  return units;
}

/** Optional address override env; empty/unset falls back, invalid throws. */
function parseAddressOverride(raw: string | undefined, fallback: string, name: string): string {
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!isAddress(raw)) throw new Error(`${name} is not a valid address: ${raw}`);
  return raw;
}

function x402FacilitatorUrl(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim();
  return trimmed !== '' ? trimmed : DEFAULT_X402_FACILITATOR_URL;
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
  let rpcUrl = base.rpcUrl;
  if (chainName === 'local') {
    rpcUrl = env.WEBCAP_RPC_URL ?? 'http://127.0.0.1:8545';
    const localUsdc = env.LOCAL_USDC_CONTRACT ?? env.WEBCAP_USDC_ADDRESS;
    if (localUsdc === undefined || localUsdc === '') {
      throw new Error('LOCAL_USDC_CONTRACT (or WEBCAP_USDC_ADDRESS) is required when WEBCAP_CHAIN=local');
    }
    if (!isAddress(localUsdc)) {
      throw new Error(`LOCAL_USDC_CONTRACT is not a valid address: ${localUsdc}`);
    }
    usdcContract = localUsdc;
  }

  const merchantPrivateKey = env.USDC_MERCHANT_PRIVATE_KEY ?? '';
  const merchantAddress =
    merchantPrivateKey !== '' ? new Wallet(merchantPrivateKey).address : (env.WEBCAP_MERCHANT_ADDRESS ?? '');

  return {
    chain: { name: chainName, rpcUrl, chainId: base.chainId, usdcContract, explorer: base.explorer },
    chainId: base.chainId,
    rpcUrl,
    usdcAddress: usdcContract,
    merchantAddress,
    port: parsePositiveInt(env.WEBCAP_PORT, 8080),
    pollIntervalMs: parsePositiveInt(env.POLL_INTERVAL_MS, 30_000),
    merchantPrivateKey,
    dbPath: env.WEBCAP_DB ?? 'data/webcap.db',
    x402Network: chainName === 'local' ? undefined : X402_NETWORKS[chainName],
    x402Asset: parseAddressOverride(env.WEBCAP_X402_ASSET, usdcContract, 'WEBCAP_X402_ASSET'),
    x402PayTo: parseAddressOverride(env.WEBCAP_X402_PAY_TO, merchantAddress, 'WEBCAP_X402_PAY_TO'),
    x402PriceUsdcUnits: parseX402PriceUsdc(env.WEBCAP_X402_PRICE_USDC),
    x402FacilitatorUrl: x402FacilitatorUrl(env.X402_FACILITATOR_URL),
  };
}
