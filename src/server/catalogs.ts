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
  '/v1/x402/map-lite',
  '/v1/x402/video',
  '/v1/x402/analyze',
  '/v1/x402/analyze/batch',
  '/v1/x402/watches/topup',
  '/v1/watches',
  '/v1/extract/preview',
  '/og-debugger',
  '/compare',
  '/transparency',
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
          'Structured extraction of the main content (title, headings, paragraphs, links, images, document-order markdown; nav/cookie/sidebar/footer excluded; optional maxContentWords budget); batch up to 50 URLs per payment',
      },
      {
        path: 'POST /v1/x402/audit',
        usdc: config.x402AuditPriceUsdcUnits / USDC_SCALE,
        description: 'SEO basics + link/OG health in one call (title, description, OG tags, link health)',
      },
      {
        path: 'POST /v1/x402/map-lite',
        usdc: config.x402AuditPriceUsdcUnits / USDC_SCALE,
        description: 'Map a site to its URL list via sitemap/robots plus a 1-hop same-host crawl in one call',
      },
      {
        path: 'POST /v1/x402/video',
        usdc: config.x402VideoPriceUsdcUnits / USDC_SCALE,
        description: 'Scroll-capture a URL as an MP4/WebM video in one call',
      },
      {
        path: 'POST /v1/x402/analyze',
        usdc: config.x402ExtractPriceUsdcUnits / USDC_SCALE,
        description: 'AI-powered visual analysis: classification, accessibility, layout, entities, sentiment',
      },
      {
        path: 'POST /v1/x402/analyze/batch',
        usdc: config.x402ExtractPriceUsdcUnits / USDC_SCALE,
        description: 'Batch AI analysis of up to 10 URLs under one payment',
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
      { path: 'GET /v1/x402/trial/status?payer=...', note: 'trial menu per wallet (claimed/available + claim recipe + the priced paid catalog and howToPay)' },
      { path: 'GET /v1/x402/trial/quick?url=...', note: 'no-wallet JPEG thumbnail, 3/day per IP' },
      { path: 'POST /v1/x402/trial', note: 'free full PNG capture trial, one per wallet (EIP-191 proof)' },
      { path: 'POST /v1/x402/trial/extract', note: 'free single-URL extraction trial, one per wallet' },
      { path: 'POST /v1/x402/trial/audit', note: 'free SEO + link/OG audit trial, one per wallet' },
      { path: 'POST /v1/x402/trial/map-lite', note: 'free site-map trial capped at 10 URLs, one per wallet' },
      { path: 'POST /v1/x402/trial/analyze', note: 'free deterministic analysis trial, one per wallet' },
    ],
    openapi: `${base}/openapi.json`,
    sitemap: `${base}/sitemap.xml`,
    // x402scan verified-ownership; omitted entirely when unsigned.
    ...(ownershipProofs.length > 0 ? { ownershipProofs } : {}),
  };
}

/** A2A v1.0 agent card with x402 payments info, for agent-card consumers. */
export async function agentCard(config: WebcapConfig) {
  const base = httpsBase(config.publicBaseUrl);
  const paid = (id: string, name: string, description: string, tags: string[]) => ({ id, name, description, tags });
  return {
    protocolVersion: '1.0',
    name: 'webcap',
    description: (await x402WellKnown(config)).description,
    // Compat: v0.x readers use top-level url; v1.0 readers use supportedInterfaces[0].
    url: base,
    supportedInterfaces: [{ url: base, protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' }],
    iconUrl: `${base}/icon.png`,
    version: '1.1.0',
    provider: { organization: 'webcap', url: 'https://github.com/shoutsid-lab/webcap' },
    documentationUrl: `${base}/skill.md`,
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['application/json', 'text/plain'],
    defaultOutputModes: ['application/json'],
    securitySchemes: {
      x402: { type: 'http', scheme: 'x402', description: 'Paid endpoints answer HTTP 402 with an x402 v2 challenge; retry with the PAYMENT-SIGNATURE header after a gasless EIP-3009 USDC signature.' },
    },
    skills: [
      paid(
        'trial',
        'Free product trials (no USDC)',
        'One free result per wallet per endpoint — capture (full PNG), extract (single URL), audit, map-lite, analyze — proven by EIP-191 personal_sign of "Claim one free webcap trial {endpoint} for {lowercase-0x}". Menu (also lists every paid endpoint with its price and how to pay): GET /v1/x402/trial/status?payer=0x…. Claim: POST /v1/x402/trial (+/extract, +/audit, +/map-lite, +/analyze). No-wallet thumbnail: GET /v1/x402/trial/quick?url=… (3/day/IP).',
        ['free', 'trial', 'screenshot', 'extraction', 'audit', 'sitemap', 'analysis'],
      ),
      paid(
        'preview',
        'Free structured preview',
        'Bounded title/headings/links/markdown preview, rate-limited per IP: GET /v1/extract/preview?url=…. Free OG metadata: GET /v1/og?url=….',
        ['free', 'preview', 'scraping', 'extraction', 'opengraph'],
      ),
      paid(
        'capture',
        'Web capture',
        `Screenshot any URL as PNG/JPEG/PDF + free OG metadata — ${config.x402PriceUsdcUnits / USDC_SCALE} USDC via x402`,
        ['screenshot', 'capture', 'x402', 'usdc'],
      ),
      paid(
        'extract',
        'Structured extraction',
        `Main content only (nav/cookie/sidebar/footer excluded): title, headings, paragraphs, links, images, document-order markdown, with an optional maxContentWords context budget; batch up to 50 URLs — ${config.x402ExtractPriceUsdcUnits / USDC_SCALE} USDC via x402`,
        ['scraping', 'extraction', 'markdown', 'x402', 'usdc'],
      ),
      paid(
        'audit',
        'SEO audit',
        `SEO basics + link/OG health in one call — ${config.x402AuditPriceUsdcUnits / USDC_SCALE} USDC via x402`,
        ['seo', 'audit', 'links', 'opengraph', 'x402', 'usdc'],
      ),
      paid(
        'map-lite',
        'Site mapping',
        `Sitemap/robots + 1-hop same-host crawl URL list in one call — ${config.x402AuditPriceUsdcUnits / USDC_SCALE} USDC via x402`,
        ['sitemap', 'crawl', 'mapping', 'x402', 'usdc'],
      ),
      paid(
        'video',
        'Video capture',
        `Scroll-capture a URL as an MP4/WebM video — ${config.x402VideoPriceUsdcUnits / USDC_SCALE} USDC via x402`,
        ['video', 'capture', 'x402', 'usdc'],
      ),
      paid(
        'analyze',
        'Visual analysis',
        `AI-powered page analysis: classification, accessibility, entities, sentiment — ${config.x402ExtractPriceUsdcUnits / USDC_SCALE} USDC via x402`,
        ['ai', 'analysis', 'classification', 'accessibility', 'x402', 'usdc'],
      ),
      paid(
        'watch',
        'Scheduled monitoring',
        `Pre-pay ${WATCH_TOPUP_RUNS} runs of a capture/extract monitor with change-detection webhooks — ${watchTopUpPriceUsdcUnits('capture', config) / USDC_SCALE}–${watchTopUpPriceUsdcUnits('extract', config) / USDC_SCALE} USDC per pack via x402`,
        ['monitoring', 'diff', 'webhook', 'x402', 'usdc'],
      ),
    ],
    // webcap extensions (non-A2A): payment + auth-scheme detail for x402 clients.
    authentication: { schemes: ['x402'] },
    payments: {
      provider: 'x402',
      network: config.x402Network ?? null,
      asset: config.x402Network === undefined ? null : config.x402Asset,
      payTo: config.x402Network === undefined ? null : config.x402PayTo,
      facilitator: config.x402FacilitatorUrl,
    },
  };
}

/** Prompt-friendly tool definitions (OpenAI functions shape) for copy-paste agent wiring. */
export function openaiTools(config: WebcapConfig) {
  const base = httpsBase(config.publicBaseUrl);
  const urlParam = { type: 'object', properties: { url: { type: 'string', description: 'Target page URL (https)' } }, required: ['url'] };
  const claimParams = {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Target page URL (https)' },
      payer: { type: 'string', description: 'Your lowercase 0x EVM address' },
      signature: {
        type: 'string',
        description:
          'EIP-191 personal_sign of exactly "Claim one free webcap trial {endpoint} for {payer}" (e.g. endpoint "extract"). One claim per wallet per endpoint; second claim answers 409 with a paidNext pointer.',
      },
    },
    required: ['url', 'payer', 'signature'],
  };
  const fn = (name: string, description: string, parameters: unknown, path: string) => ({
    type: 'function',
    endpoint: { method: name === 'webcap_preview' || name === 'webcap_og' || name === 'webcap_trial_status' || name === 'webcap_quick_thumbnail' ? 'GET' : 'POST', path },
    function: { name, description, parameters },
  });
  return {
    format: 'openai-functions',
    name: 'webcap',
    baseUrl: base,
    openapi: `${base}/openapi.json`,
    skill: `${base}/skill.md`,
    tools: [
      fn('webcap_preview', 'Free bounded structured preview of a URL (title, headings, links, truncated markdown).', urlParam, '/v1/extract/preview?url=...'),
      fn('webcap_og', 'Free Open Graph metadata for a URL.', urlParam, '/v1/og?url=...'),
      fn(
        'webcap_trial_status',
        'Which free trials a wallet claimed / can still claim, the exact claim recipe, and the priced paid catalog with how to pay (x402) once the free calls are used.',
        { type: 'object', properties: { payer: { type: 'string', description: 'Lowercase 0x address to look up' } }, required: ['payer'] },
        '/v1/x402/trial/status?payer=...',
      ),
      fn('webcap_trial_claim_capture', 'Free full PNG capture trial (one per wallet).', claimParams, '/v1/x402/trial'),
      fn('webcap_trial_claim_extract', 'Free single-URL structured extraction trial (one per wallet; no schema/model/batch).', claimParams, '/v1/x402/trial/extract'),
      fn('webcap_trial_claim_audit', 'Free single-URL SEO + link/OG health audit trial (one per wallet).', claimParams, '/v1/x402/trial/audit'),
      fn('webcap_trial_claim_map_lite', 'Free site-map trial, capped at 10 URLs (one per wallet).', claimParams, '/v1/x402/trial/map-lite'),
      fn('webcap_trial_claim_analyze', 'Free deterministic single-URL visual analysis trial (one per wallet; model-backed analysis stays paid).', claimParams, '/v1/x402/trial/analyze'),
      fn('webcap_quick_thumbnail', 'No-wallet free JPEG thumbnail (3/day per IP; full trials need a wallet signature).', urlParam, '/v1/x402/trial/quick?url=...'),
    ],
  };
}

/** Tool-router-friendly manifest (MCP tools/list shape + the HTTPS endpoint each tool maps to). */
export function mcpTools(config: WebcapConfig) {
  const base = httpsBase(config.publicBaseUrl);
  const tools = openaiTools(config).tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    inputSchema: t.function.parameters,
    endpoint: t.endpoint,
  }));
  return {
    format: 'mcp-tools-list',
    server: { name: 'webcap', version: '1.1.0', url: base, openapi: `${base}/openapi.json`, skill: `${base}/skill.md` },
    // The remote transport, so a host that speaks MCP can wire webcap with no
    // install: point it at this URL and it gets the same tool set as the
    // npm/stdio server. It holds no wallet, so paid tools answer the 402
    // challenge for the caller to settle with its own x402 client.
    mcp: {
      transport: 'streamable-http',
      url: `${base}/mcp`,
      method: 'POST',
      note: 'JSON-RPC 2.0 (initialize, tools/list, tools/call). No install, no session, no API key. Paid tool calls return the x402 402 challenge.',
    },
    payment: 'Paid endpoints settle gasless USDC via x402 (HTTP 402); every 409/402 response carries a paidNext pointer.',
    tools,
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
        { path: 'GET /v1/x402/trial/status?payer=...', note: 'trial menu per wallet (claimed/available + claim recipe + the priced paid catalog and howToPay)' },
        { path: 'GET /v1/x402/trial/quick?url=...', note: 'no-wallet JPEG thumbnail, 3/day per IP' },
        { path: 'POST /v1/x402/trial', note: 'free full PNG capture trial, one per wallet (EIP-191 proof)' },
        { path: 'POST /v1/x402/trial/extract', note: 'free single-URL extraction trial, one per wallet' },
        { path: 'POST /v1/x402/trial/audit', note: 'free SEO + link/OG audit trial, one per wallet' },
        { path: 'POST /v1/x402/trial/map-lite', note: 'free site-map trial capped at 10 URLs, one per wallet' },
        { path: 'POST /v1/x402/trial/analyze', note: 'free deterministic analysis trial, one per wallet' },
      ],
      paid: [
        { path: 'POST /v1/x402/capture', usdc: config.x402PriceUsdcUnits / USDC_SCALE, note: 'PNG/JPEG/PDF screenshot + free OG' },
        { path: 'POST /v1/x402/extract', usdc: config.x402ExtractPriceUsdcUnits / USDC_SCALE, note: 'structured JSON; batch up to 50 URLs for one payment' },
        { path: 'POST /v1/x402/audit', usdc: config.x402AuditPriceUsdcUnits / USDC_SCALE, note: 'SEO basics + link/OG health in one call' },
        { path: 'POST /v1/x402/map-lite', usdc: config.x402AuditPriceUsdcUnits / USDC_SCALE, note: 'site URL list via sitemap/robots plus a 1-hop same-host crawl' },
        { path: 'POST /v1/x402/video', usdc: config.x402VideoPriceUsdcUnits / USDC_SCALE, note: 'scroll-capture MP4/WebM video in one call' },
        { path: 'POST /v1/x402/analyze', usdc: config.x402ExtractPriceUsdcUnits / USDC_SCALE, note: 'AI visual analysis: classification, accessibility, entities, sentiment' },
        { path: 'POST /v1/x402/analyze/batch', usdc: config.x402ExtractPriceUsdcUnits / USDC_SCALE, note: 'batch AI analysis of up to 10 URLs for one payment' },
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
