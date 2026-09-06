/**
 * Discovery catalog payload builders: the x402 well-known catalog, the A2A
 * agent card, the JSON front-door payload, and the sitemap. Pure functions of
 * WebcapConfig (no Fastify); served by the routes in ./discovery.ts.
 */
import { USDC_SCALE, WATCH_TOPUP_RUNS, watchTopUpPriceUsdcUnits, type ChainName, type WebcapConfig } from '../config.js';
import { ownershipProof } from './openapi/ownership.js';

/** Public paths advertised in the sitemap (the stable service surface). */
const SITEMAP_PATHS = [
  '/',
  '/openapi.json',
  '/icon.png',
  '/v1/x402/service',
  '/v1/x402/capture',
  '/v1/x402/extract',
  '/v1/x402/audit',
  '/v1/x402/watches/topup',
  '/v1/watches',
  '/v1/extract/preview',
] as const;

/** XML-escape a value before embedding it in the sitemap (fixed list, stay correct). */
function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** The sitemap must be protocol-absolute https, even for an http:// dev base URL. */
function httpsBase(base: string): string {
  return base.startsWith('http://') ? `https://${base.slice('http://'.length)}` : base;
}

/** Build the sitemap.xml payload: one <url> per public path, https-absolute. */
export function sitemapXml(config: WebcapConfig): string {
  const base = httpsBase(config.publicBaseUrl);
  const entries = SITEMAP_PATHS.map(
    (path) => `  <url>\n    <loc>${xmlEscape(`${base}${path}`)}</loc>\n  </url>`,
  ).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entries,
    '</urlset>',
    '',
  ].join('\n');
}

/** The chain phrase of the well-known catalog description, per configured chain (compiler-checked exhaustive). */
const CHAIN_COPY: Record<ChainName, string> = {
  base: 'Base mainnet',
  'base-sepolia': 'Base Sepolia (testnet)',
  local: 'a local Anvil dev chain',
};

/** x402 machine-discovery catalog: what to call, what it costs, how to pay. */
export async function x402WellKnown(config: WebcapConfig) {
  const base = httpsBase(config.publicBaseUrl);
  const ownershipProofs = await ownershipProof(config.publicBaseUrl, config.merchantPrivateKey);
  return {
    service: 'webcap',
    description: `Pay-per-call web capture on ${CHAIN_COPY[config.chain.name]}: one-time screenshots (PNG/JPEG/PDF + free Open Graph metadata), structured content extraction, and scheduled monitoring with change-detection webhooks. All paid routes settle gasless USDC via x402 (HTTP 402).`,
    network: config.x402Network ?? null,
    asset: config.x402Network === undefined ? null : config.x402Asset,
    payTo: config.x402Network === undefined ? null : config.x402PayTo,
    facilitator: config.x402FacilitatorUrl,
    endpoints: [
      {
        path: 'POST /v1/x402/capture',
        usdc: config.x402PriceUsdcUnits / USDC_SCALE,
        description: 'Screenshot any URL (PNG/JPEG/PDF) + free Open Graph metadata',
      },
      {
        path: 'POST /v1/x402/extract',
        usdc: config.x402ExtractPriceUsdcUnits / USDC_SCALE,
        description:
          'Structured extraction (title, headings, paragraphs, links, images, document-order markdown); batch up to 10 URLs per payment',
      },
      {
        path: 'POST /v1/x402/audit',
        usdc: config.x402AuditPriceUsdcUnits / USDC_SCALE,
        description: 'SEO basics + link/OG health in one call (title, description, OG tags, link health)',
      },
      {
        path: 'POST /v1/x402/watches/topup',
        usdc:
          watchTopUpPriceUsdcUnits('capture', config) / USDC_SCALE,
        usdcMax: watchTopUpPriceUsdcUnits('extract', config) / USDC_SCALE,
        description: `Pre-pay ${WATCH_TOPUP_RUNS} scheduled monitor runs (capture-pack price shown; extract-pack is usdcMax; exact price quoted per watch via ?watchId=)`,
      },
    ],
    free: [
      { path: 'GET /v1/extract/preview?url=...', note: 'bounded structured preview (rate-limited)' },
      { path: 'GET /v1/og?url=...', note: 'Open Graph metadata' },
      { path: 'GET /v1/health', note: 'liveness + chain' },
    ],
    openapi: `${base}/openapi.json`,
    sitemap: `${base}/sitemap.xml`,
    // x402scan verified-ownership; omitted entirely when unsigned.
    ...(ownershipProofs.length > 0 ? { ownershipProofs } : {}),
  };
}

/** A2A-style agent card with an x402/AP2 payments section, for agent-card consumers. */
export async function agentCard(config: WebcapConfig) {
  const base = httpsBase(config.publicBaseUrl);
  return {
    protocolVersion: '0.3.0',
    name: 'webcap',
    description: (await x402WellKnown(config)).description,
    url: base,
    icon: `${base}/icon.png`,
    version: '1.0.0',
    roles: ['merchant'],
    capabilities: { streaming: false, pushNotifications: true },
    authentication: { schemes: ['x402'] },
    payments: {
      provider: 'x402',
      network: config.x402Network ?? null,
      asset: config.x402Network === undefined ? null : config.x402Asset,
      payTo: config.x402Network === undefined ? null : config.x402PayTo,
      facilitator: config.x402FacilitatorUrl,
    },
    skills: [
      {
        id: 'capture',
        name: 'Web capture',
        description: `Screenshot any URL as PNG/JPEG/PDF + free OG metadata — ${config.x402PriceUsdcUnits / USDC_SCALE} USDC via x402`,
        tags: ['screenshot', 'capture', 'x402', 'usdc'],
      },
      {
        id: 'extract',
        name: 'Structured extraction',
        description: `Title, headings, paragraphs, links, images, document-order markdown; batch up to 10 URLs — ${config.x402ExtractPriceUsdcUnits / USDC_SCALE} USDC via x402`,
        tags: ['scraping', 'extraction', 'markdown', 'x402', 'usdc'],
      },
      {
        id: 'audit',
        name: 'SEO audit',
        description: `SEO basics + link/OG health in one call — ${config.x402AuditPriceUsdcUnits / USDC_SCALE} USDC via x402`,
        tags: ['seo', 'audit', 'links', 'opengraph', 'x402', 'usdc'],
      },
      {
        id: 'watch',
        name: 'Scheduled monitoring',
        description: `Pre-pay ${WATCH_TOPUP_RUNS} runs of a capture/extract monitor with change-detection webhooks — ${watchTopUpPriceUsdcUnits('capture', config) / USDC_SCALE}–${watchTopUpPriceUsdcUnits('extract', config) / USDC_SCALE} USDC per pack via x402`,
        tags: ['monitoring', 'diff', 'webhook', 'x402', 'usdc'],
      },
    ],
  };
}

/** The JSON front-door payload, unchanged byte-for-byte for pure-JSON clients. */
export function frontDoorPayload(config: WebcapConfig) {
  return {
    service: 'webcap',
    tagline:
      'Capture any URL as a screenshot, or extract its structured content + clean document-order markdown — paid per-request in USDC over x402 (HTTP 402).',
    endpoints: {
      free: [
        { path: 'GET /v1/extract/preview?url=...', note: 'bounded structured preview (rate-limited)' },
        { path: 'GET /v1/og?url=...', note: 'OG metadata' },
        { path: 'GET /v1/health', note: 'liveness + chain' },
      ],
      paid: [
        { path: 'POST /v1/x402/capture', usdc: config.x402PriceUsdcUnits / USDC_SCALE, note: 'PNG/JPEG/PDF screenshot + free OG' },
        { path: 'POST /v1/x402/extract', usdc: config.x402ExtractPriceUsdcUnits / USDC_SCALE, note: 'structured JSON; batch up to 10 URLs for one payment' },
        { path: 'POST /v1/x402/audit', usdc: config.x402AuditPriceUsdcUnits / USDC_SCALE, note: 'SEO basics + link/OG health in one call' },
      ],
    },
    catalog: 'GET /v1/x402/service — full agent-discoverable descriptor + the exact x402 payment flow',
    agentGuide: 'AGENT.md — how an AI agent discovers + pays (gasless EIP-3009, no ETH)',
    payment:
      config.x402Network === undefined
        ? 'x402 disabled (WEBCAP_CHAIN=local)'
        : `x402 v2 on ${config.x402Network}, asset ${config.x402Asset}, payTo ${config.x402PayTo}`,
  };
}
