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
    kicker: 'WEB CAPTURE API · screenshots · extraction · monitoring',
    lede: 'The developer API for <strong>screenshot capture</strong>, <strong>structured extraction</strong>, and <strong>change monitoring</strong>. One HTTP call gets you PNG/JPEG/PDF screenshots, title-to-markdown extraction, or scheduled watches with webhook alerts.',
    settlement: 'settled in USDC on Base mainnet',
    snippetNote: 'Base mainnet USDC · x402 v2 "exact" scheme · gasless EIP-3009',
  },
  'base-sepolia': {
    kicker: 'WEB CAPTURE API · screenshots · extraction · monitoring',
    lede: 'The developer API for <strong>screenshot capture</strong>, <strong>structured extraction</strong>, and <strong>change monitoring</strong>. One HTTP call gets you PNG/JPEG/PDF screenshots, title-to-markdown extraction, or scheduled watches with webhook alerts.',
    settlement: 'settled in USDC on Base Sepolia (testnet)',
    snippetNote: 'Base Sepolia USDC · x402 v2 "exact" scheme · gasless EIP-3009',
  },
  local: {
    kicker: 'WEB CAPTURE API · screenshots · extraction · monitoring',
    lede: 'The developer API for <strong>screenshot capture</strong>, <strong>structured extraction</strong>, and <strong>change monitoring</strong>. One HTTP call gets you PNG/JPEG/PDF screenshots, title-to-markdown extraction, or scheduled watches with webhook alerts. x402 payments are disabled in local mode.',
    settlement: 'x402 settlement is disabled locally — the prices below are the production USDC prices',
    snippetNote: 'x402 disabled locally — the sample below uses the Base Sepolia testnet network',
  },
};

export { CHAIN_COPY };
