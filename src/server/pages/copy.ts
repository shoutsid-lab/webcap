/**
 * Chain-conditional landing copy: a deploy must never advertise a network it
 * isn't on (mainnet copy on a sepolia deploy would send real USDC to a test
 * network and vice versa). Record<ChainName, …> makes the split exhaustive —
 * a new chain in config.ts is a compile error here until it has copy. Split
 * out of pages.ts as a pure move (no behavior change).
 */
import type { ChainName } from '../../config.js';

const CHAIN_COPY: Record<
  ChainName,
  { readonly kicker: string; readonly lede: string; readonly settlement: string; readonly snippetNote: string }
> = {
  base: {
    kicker: 'LIVE ON BASE MAINNET — real USDC · x402 v2 · gasless EIP-3009',
    lede: 'Live on <strong>Base mainnet</strong>: every call is an HTTP 402 micro-payment in <strong>real USDC over x402 v2</strong>, settled <strong>gasless</strong> — you sign an EIP-3009 <code>transferWithAuthorization</code> and the facilitator submits it and pays the gas; no API keys, no accounts, no ETH.',
    settlement: 'settled in USDC on Base mainnet',
    snippetNote: 'Base mainnet USDC · x402 v2 "exact" scheme · gasless EIP-3009',
  },
  'base-sepolia': {
    kicker: 'LIVE ON BASE SEPOLIA — testnet USDC · x402 v2 · gasless EIP-3009',
    lede: 'Live on <strong>Base Sepolia</strong> (testnet): every call is an HTTP 402 micro-payment in <strong>testnet USDC over x402 v2</strong>, settled <strong>gasless</strong> — you sign an EIP-3009 <code>transferWithAuthorization</code> and the facilitator submits it and pays the gas; no API keys, no accounts, no ETH.',
    settlement: 'settled in USDC on Base Sepolia (testnet)',
    snippetNote: 'Base Sepolia USDC · x402 v2 "exact" scheme · gasless EIP-3009',
  },
  local: {
    kicker: 'LOCAL DEV CHAIN — x402 disabled · same flow in production',
    lede: 'Running on a <strong>local dev chain</strong> — x402 payments are disabled in this mode. Capture, extraction and watches run unchanged, and the payment flow below is exactly what clients do on <strong>Base</strong> in production: HTTP 402 → sign → retry; no API keys, no accounts.',
    settlement: 'x402 settlement is disabled locally — the prices below are the production USDC prices',
    snippetNote: 'x402 disabled locally — the sample below uses the Base Sepolia testnet network',
  },
};

export { CHAIN_COPY };
