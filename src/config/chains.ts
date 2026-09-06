/**
 * The chain table + x402 network identity for webcap: per-chain RPC/chain-id/
 * USDC contract/explorer (the CHAINS table), the CAIP-2 x402 network mapping,
 * and the canonical EIP-712 domain of each chain's USDC deploy (single source
 * for the domain values: the CHAINS table). Split out of config.ts as a pure
 * move (no behavior change); config.ts re-exports everything it used to.
 */
export type ChainName = 'base-sepolia' | 'base' | 'local';
/** CAIP-2 network ids for the x402 wire. `undefined` = x402 disabled. */
export type X402Network = 'eip155:84532' | 'eip155:8453';

export interface ChainConfig {
  readonly name: ChainName;
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly usdcContract: string;
  readonly explorer: string;
  /**
   * EIP-712 domain of this chain's USDC deploy (single source for the x402
   * signing `extra`). `undefined` on local anvil (no real USDC; x402 disabled).
   */
  readonly usdcEip712Domain?: { readonly name: string; readonly version: string };
}

export const CHAINS: Record<ChainName, Omit<ChainConfig, 'name'>> = {
  'base-sepolia': {
    rpcUrl: 'https://sepolia.base.org',
    chainId: 84532,
    usdcContract: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    explorer: 'https://sepolia.basescan.org',
    usdcEip712Domain: { name: 'USDC', version: '2' },
  },
  base: {
    rpcUrl: 'https://mainnet.base.org',
    chainId: 8453,
    usdcContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    explorer: 'https://basescan.org',
    usdcEip712Domain: { name: 'USD Coin', version: '2' },
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

export type Eip712Domain = { readonly name: string; readonly version: string };

function eip712DomainOf(chainName: Exclude<ChainName, 'local'>): Eip712Domain {
  const domain = CHAINS[chainName].usdcEip712Domain;
  if (domain === undefined) throw new Error(`chain ${chainName} is missing its USDC EIP-712 domain`);
  return domain;
}

/**
 * EIP-712 domain of each chain's USDC deploy, keyed by x402 CAIP-2 network.
 * Single source for the domain values: the CHAINS table. A mismatch makes
 * every payment signature unrecoverable (sepolia "USDC" vs mainnet "USD Coin").
 */
export const EIP712_DOMAINS: Record<X402Network, Eip712Domain> = {
  'eip155:84532': eip712DomainOf('base-sepolia'),
  'eip155:8453': eip712DomainOf('base'),
};
