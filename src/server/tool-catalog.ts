/**
 * The canonical agent tool catalog: one list of every capability an agent can
 * call, free or paid.
 *
 * Why this file exists. Before it, webcap published three tool catalogs that
 * barely overlapped:
 *
 *   - `/.well-known/openai-tools.json` and `/.well-known/mcp-tools.json` listed
 *     9 tools, all free, and not one paid product;
 *   - the MCP server's tool table listed 11 tools, including all 6 paid
 *     products and no trial.
 *
 * Their intersection was two tools. So an agent that wired webcap from a
 * manifest learned that we sell nothing, and an MCP host never learned that the
 * free trial rail exists. That is the exact failure the charter's rule 2
 * describes: a surface that lies to an agent costs a real call, and a crawler
 * that reads manifests is a customer's first impression. BrickBlueBot
 * (agentic-web registry) reads ours on a schedule.
 *
 * The membership, schemas and endpoints now live here once. `openaiTools` and
 * `mcpTools` are both derived from it, and
 * `tests/unit/tool-catalog-agreement.test.ts` pins the MCP server's own tool
 * table to the same names, so the three cannot drift apart again.
 */
import { USDC_SCALE, type WebcapConfig } from '../config.js';

export interface CatalogTool {
  readonly name: string;
  readonly description: string;
  readonly free: boolean;
  readonly method: 'GET' | 'POST';
  /** REST path. GET forms carry their query string, so the path is callable as written. */
  readonly path: string;
  readonly inputSchema: Record<string, unknown>;
  /** Atomic 6-decimal USDC units, paid tools only. */
  readonly priceUsdcUnits?: number;
}

const URL_PROP = { url: { type: 'string', description: 'Absolute http(s) URL to fetch' } } as const;

/** Trial claims are wallet-signed, one per wallet per endpoint. */
const CLAIM_PROPS = {
  url: { type: 'string', description: 'Target page URL (https)' },
  payer: { type: 'string', description: 'Your lowercase 0x EVM address' },
  signature: {
    type: 'string',
    description:
      'EIP-191 personal_sign of exactly "Claim one free webcap trial {endpoint} for {payer}", with {payer} lowercase. One claim per wallet per endpoint; a repeat answers 409 with a paidNext pointer.',
  },
} as const;

/** Paid tools settle per call in USDC over x402; the price is stated in prose. */
function paidPrefix(units: number): string {
  return `PAID ($${(units / USDC_SCALE).toString()}): `;
}

/**
 * Every agent-callable capability, in surface order: free discovery and trials
 * first, then the paid products.
 */
export function serviceTools(config: WebcapConfig): readonly CatalogTool[] {
  const capture = config.x402PriceUsdcUnits;
  const extract = config.x402ExtractPriceUsdcUnits;
  const audit = config.x402AuditPriceUsdcUnits;
  const video = config.x402VideoPriceUsdcUnits;
  return [
    // --- free: discovery ---
    {
      name: 'webcap_preview',
      description: 'Free bounded structured preview of a URL (title, headings, links, truncated markdown). Use before paying.',
      free: true,
      method: 'GET',
      path: '/v1/extract/preview?url=...',
      inputSchema: { type: 'object', properties: { ...URL_PROP }, required: ['url'] },
    },
    {
      name: 'webcap_og',
      description: 'Free Open Graph metadata for a URL: title, description, image, icon. No payment.',
      free: true,
      method: 'GET',
      path: '/v1/og?url=...',
      inputSchema: { type: 'object', properties: { ...URL_PROP }, required: ['url'] },
    },
    {
      name: 'webcap_service',
      description:
        'Free machine catalog: every paid endpoint with its exact price, the network, USDC asset, payTo, facilitator and the how-to-pay flow. Call this first to learn what webcap can do and what it costs.',
      free: true,
      method: 'GET',
      path: '/v1/x402/service',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'webcap_health',
      description: 'Free liveness + chain info.',
      free: true,
      method: 'GET',
      path: '/v1/health',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'webcap_agent_funnel',
      description:
        'Free agent-income funnel: reach, 402 challenges, trial claims, paid calls, distinct paying wallets and funded watches. Aggregate only; use to see real usage.',
      free: true,
      method: 'GET',
      path: '/v1/agent-funnel',
      inputSchema: {
        type: 'object',
        properties: { hours: { type: 'integer', description: 'Window in hours (default 168 = 7 days)' } },
      },
    },

    // --- free: the trial rail (the bridge to a paid call) ---
    {
      name: 'webcap_trial_status',
      description:
        'Free per-wallet trial menu: which endpoints a wallet already claimed, which it can still claim, the exact claim recipe, and the priced paid catalog with how to pay (x402) once the free calls are used.',
      free: true,
      method: 'GET',
      path: '/v1/x402/trial/status?payer=...',
      inputSchema: {
        type: 'object',
        properties: { payer: { type: 'string', description: 'Lowercase 0x address to look up' } },
        required: ['payer'],
      },
    },
    {
      name: 'webcap_trial_claim_capture',
      description: 'Free full PNG capture trial, one per wallet: a real screenshot artifact, no payment.',
      free: true,
      method: 'POST',
      path: '/v1/x402/trial',
      inputSchema: { type: 'object', properties: { ...CLAIM_PROPS }, required: ['url', 'payer', 'signature'] },
    },
    {
      name: 'webcap_trial_claim_extract',
      description: 'Free single-URL structured extraction trial, one per wallet (no schema/model/batch).',
      free: true,
      method: 'POST',
      path: '/v1/x402/trial/extract',
      inputSchema: { type: 'object', properties: { ...CLAIM_PROPS }, required: ['url', 'payer', 'signature'] },
    },
    {
      name: 'webcap_trial_claim_audit',
      description: 'Free single-URL SEO + link/OG health audit trial, one per wallet.',
      free: true,
      method: 'POST',
      path: '/v1/x402/trial/audit',
      inputSchema: { type: 'object', properties: { ...CLAIM_PROPS }, required: ['url', 'payer', 'signature'] },
    },
    {
      name: 'webcap_trial_claim_map_lite',
      description: 'Free site-map trial, capped at 10 URLs, one per wallet.',
      free: true,
      method: 'POST',
      path: '/v1/x402/trial/map-lite',
      inputSchema: { type: 'object', properties: { ...CLAIM_PROPS }, required: ['url', 'payer', 'signature'] },
    },
    {
      name: 'webcap_trial_claim_analyze',
      description:
        'Free single-URL deterministic visual analysis trial, one per wallet. Model-backed analysis stays paid.',
      free: true,
      method: 'POST',
      path: '/v1/x402/trial/analyze',
      inputSchema: {
        type: 'object',
        properties: {
          ...CLAIM_PROPS,
          task: {
            type: 'string',
            enum: ['classification', 'accessibility', 'layout', 'entities', 'sentiment'],
            description: 'What to analyze',
          },
        },
        required: ['url', 'task', 'payer', 'signature'],
      },
    },
    {
      name: 'webcap_quick_thumbnail',
      description: 'Free no-wallet JPEG thumbnail (3/day per IP). The full trials need a wallet signature.',
      free: true,
      method: 'GET',
      path: '/v1/x402/trial/quick?url=...',
      inputSchema: { type: 'object', properties: { ...URL_PROP }, required: ['url'] },
    },
    {
      name: 'webcap_feedback',
      description:
        'Free feedback into webcap: message (8-4000 chars) plus optional category and the endpoint you were using. No account, rate-limited per client (60/hr). Also open to humans at GET /feedback.',
      free: true,
      method: 'POST',
      path: '/v1/feedback',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', minLength: 8, maxLength: 4000, description: 'Your feedback text' },
          category: {
            type: 'string',
            enum: ['bug', 'suggestion', 'pricing', 'docs', 'integration', 'other'],
            description: 'Optional category (default other)',
          },
          endpoint: { type: 'string', description: 'Optional webcap route you were using, e.g. POST /v1/x402/capture' },
        },
        required: ['message'],
      },
    },

    // --- paid: the products ---
    {
      name: 'webcap_capture',
      description:
        `${paidPrefix(capture)}screenshot a URL as PNG/JPEG/PDF and get a persistent public artifact URL plus free OG metadata. Settles gasless USDC over x402.`,
      free: false,
      method: 'POST',
      path: '/v1/x402/capture',
      priceUsdcUnits: capture,
      inputSchema: {
        type: 'object',
        properties: {
          ...URL_PROP,
          format: { type: 'string', enum: ['png', 'jpeg', 'pdf'], description: 'Screenshot format (default png)' },
          fullPage: { type: 'boolean', description: 'Capture the full scrollable page' },
        },
        required: ['url'],
      },
    },
    {
      name: 'webcap_extract',
      description:
        `${paidPrefix(extract)}structured content as JSON: title, headings, paragraphs, links, images, document-order markdown. One payment covers a batch of up to 50 URLs.`,
      free: false,
      method: 'POST',
      path: '/v1/x402/extract',
      priceUsdcUnits: extract,
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'A single page to extract' },
          urls: { type: 'array', items: { type: 'string' }, description: 'Batch (at most 50) for one payment' },
          schema: { type: 'string', description: 'Optional natural-language description of the JSON to extract' },
        },
      },
    },
    {
      name: 'webcap_audit',
      description: `${paidPrefix(audit)}SEO basics plus link and Open Graph health for one URL in a single call.`,
      free: false,
      method: 'POST',
      path: '/v1/x402/audit',
      priceUsdcUnits: audit,
      inputSchema: { type: 'object', properties: { ...URL_PROP }, required: ['url'] },
    },
    {
      name: 'webcap_map_lite',
      description: `${paidPrefix(audit)}a site URL list from sitemap/robots plus a 1-hop same-host crawl (maxUrls up to 50, default 20).`,
      free: false,
      method: 'POST',
      path: '/v1/x402/map-lite',
      priceUsdcUnits: audit,
      inputSchema: {
        type: 'object',
        properties: { ...URL_PROP, maxUrls: { type: 'integer', description: '1-50 (default 20)' } },
        required: ['url'],
      },
    },
    {
      name: 'webcap_video',
      description: `${paidPrefix(video)}scroll-capture a page as an MP4/WebM video artifact.`,
      free: false,
      method: 'POST',
      path: '/v1/x402/video',
      priceUsdcUnits: video,
      inputSchema: {
        type: 'object',
        properties: {
          ...URL_PROP,
          format: { type: 'string', enum: ['mp4', 'webm'], description: 'Video format (default mp4)' },
          durationMs: { type: 'integer', description: 'Scroll duration in ms (default 5000, max 30000)' },
        },
        required: ['url'],
      },
    },
    {
      name: 'webcap_analyze',
      description: `${paidPrefix(extract)}AI analysis of one URL: classification, accessibility, layout, entities or sentiment.`,
      free: false,
      method: 'POST',
      path: '/v1/x402/analyze',
      priceUsdcUnits: extract,
      inputSchema: {
        type: 'object',
        properties: {
          ...URL_PROP,
          task: {
            type: 'string',
            enum: ['classification', 'accessibility', 'layout', 'entities', 'sentiment'],
            description: 'What to analyze',
          },
        },
        required: ['url', 'task'],
      },
    },
  ];
}

/** The names every tool surface must expose, for the agreement test. */
export function catalogToolNames(config: WebcapConfig): readonly string[] {
  return serviceTools(config).map((t) => t.name);
}