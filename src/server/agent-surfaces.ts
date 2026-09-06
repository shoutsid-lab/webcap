/**
 * The agent-facing discovery surfaces: GET /llms.txt (the llms.txt convention
 * document, so LLM agents that crawl well-known files find webcap) and
 * GET /skill.md (an installable agent skill file teaching the x402 flow).
 *
 * Both routes are free, unauthenticated, and static per deployment: the only
 * interpolated values come from config (base URL, x402 network/asset/payTo,
 * facilitator URL, the price points, and the priceUsdcUnits examples).
 * Everything else is literal prose — keep it in sync with the live routes
 * (src/server/routes.ts, src/server/watches.ts) and the config defaults
 * (DEFAULT_X402_PRICE_USDC_UNITS = $0.001,
 * DEFAULT_X402_EXTRACT_PRICE_USDC_UNITS = $0.01).
 */
import type { FastifyInstance } from 'fastify';
import { USDC_SCALE, watchTopUpPriceUsdcUnits, type WebcapConfig } from '../config.js';

/**
 * Register the agent-facing discovery routes: GET /llms.txt and GET /skill.md.
 * Both are free (no x402 challenge, no auth) and served as text/markdown.
 */
export function registerAgentSurfaces(app: FastifyInstance, config: WebcapConfig): void {
  app.get('/llms.txt', async (_req, reply) => {
    reply.header('content-type', 'text/markdown; charset=utf-8');
    reply.header('cache-control', 'public, max-age=300');
    return reply.send(llmsTxt(config));
  });

  app.get('/skill.md', async (_req, reply) => {
    reply.header('content-type', 'text/markdown; charset=utf-8');
    reply.header('cache-control', 'public, max-age=300');
    return reply.send(skillMd(config));
  });
}

/** Atomic 6-decimal USDC units → "$X.YYY" (1000 → "$0.001", 1000000 → "$1"). */
function usdc(units: number): string {
  return `$${units / USDC_SCALE}`;
}

/** The llms.txt convention document (https://llmstxt.org) for this deployment. */
function llmsTxt(config: WebcapConfig): string {
  return `# webcap — pay-per-call web capture

webcap turns any URL into a screenshot (PNG/JPEG/PDF) or structured text/JSON,
paid per call in USDC over x402 (HTTP 402). No API keys, no accounts: any EOA
holding USDC can pay, gaslessly — the payer signs an EIP-3009
transferWithAuthorization and the CDP facilitator verifies and settles it
on-chain. You pay USDC only, never ETH gas.

## Deployment

- Base URL: ${config.publicBaseUrl}
- Network: USDC on Base — ${config.x402Network ?? 'x402 disabled in this deployment'}
- USDC asset: ${config.x402Asset}
- Pay-to (merchant wallet): ${config.x402PayTo}
- Facilitator: ${config.x402FacilitatorUrl} (x402 v2 "exact" scheme)
- Service descriptor: ${config.publicBaseUrl}/v1/x402/service (JSON catalog with bazaar extension)
- OpenAPI 3.1: ${config.publicBaseUrl}/openapi.json
- Agent skill file: ${config.publicBaseUrl}/skill.md

## Paid endpoints (x402)

| Method + path | Price | Returns |
| --- | --- | --- |
| POST /v1/x402/capture | ${usdc(config.x402PriceUsdcUnits)} | Screenshot of one URL: base64 image (png/jpeg/pdf) + persistent public artifact URL |
| POST /v1/x402/extract | ${usdc(config.x402ExtractPriceUsdcUnits)} | Structured content (title, headings, paragraphs, links, images, markdown); one payment covers a batch of up to 10 URLs |
| POST /v1/x402/watches/topup | ${usdc(watchTopUpPriceUsdcUnits('capture', config))}–${usdc(watchTopUpPriceUsdcUnits('extract', config))} | 100 scheduled re-capture runs for an existing watch (capture watch ${usdc(watchTopUpPriceUsdcUnits('capture', config))}, extract watch ${usdc(watchTopUpPriceUsdcUnits('extract', config))}) |

### Request / response shapes

POST /v1/x402/capture
    {"url": "https://example.com", "format": "png"}   // format: png | jpeg | pdf (default: png)
  200 {"artifact": {"format": "png", "bytes": 123, "data": "<base64>", "url": "<base>/v1/artifacts/<uuid>"},
       "payment": {"payer": "0x…", "priceUsdcUnits": ${config.x402PriceUsdcUnits}}}

POST /v1/x402/extract
    {"url": "https://example.com"}                    // or "urls": string[] (up to 10) in one payment
    {"url": "https://example.com", "schema": "JSON with the fields: title, price"}  // optional schema-constrained extraction
  200 {"results": [{"url": "…", "status": "ok", "data": {"title": "…", "headings": […], "paragraphs": […], "links": […], "images": […], "markdown": "…"}}],
       "payment": {"payer": "0x…", "priceUsdcUnits": ${config.x402ExtractPriceUsdcUnits}}}

POST /v1/x402/watches/topup
    {"watchId": "<id from POST /v1/watches>", "runs": 100}
  200 {"watchId": "…", "credits": 100, "priceUsdcUnits": ${watchTopUpPriceUsdcUnits('capture', config)}}

## Free endpoints (no payment)

- GET /v1/extract/preview?url=… — bounded structured preview (title, headings, links, truncated markdown); rate-limited per IP
- GET /v1/og?url=… — Open Graph metadata (title, description, image, icon)
- POST /v1/watches — create a scheduled re-capture watch (free; starts with 0 credits — top up via /v1/x402/watches/topup)
- GET /v1/watches/:id — watch state + recent runs · DELETE /v1/watches/:id — remove it
- GET /v1/health — liveness + chain info

## Paying: minimal x402 flow

1. POST the endpoint unpaid → HTTP 402 with the x402 v2 challenge (JSON body, mirrored base64-encoded in the PAYMENT-REQUIRED header).
2. Read accepts[0] from the challenge ({ network, asset, amount, payTo, extra }) and sign a gasless EIP-3009 transferWithAuthorization: from = your EOA, to = payTo, value = amount (atomic 6-decimal USDC units), with the EIP-712 domain of the USDC contract (name/version from extra, chainId from network, verifyingContract = asset).
3. Retry the identical request with the header PAYMENT-SIGNATURE: <base64 payment payload>.
4. The facilitator verifies and settles on-chain; the 200 response carries the result plus a PAYMENT-RESPONSE settlement header (transaction hash, payer, amount).

Any x402 v2 client does steps 1–3 for you (e.g. @x402/axios with wrapAxiosWithPayment) — a ready-to-paste example lives in ${config.publicBaseUrl}/skill.md.
`;
}

/** The installable agent skill file (YAML frontmatter + usage instructions). */
function skillMd(config: WebcapConfig): string {
  return `---
name: webcap
description: Pay-per-call web capture API — a PNG/JPEG/PDF screenshot or structured JSON from any URL, paid gaslessly in USDC on Base via x402 (HTTP 402).
---

# webcap — pay-per-call web capture

webcap converts any URL into a screenshot artifact (PNG/JPEG/PDF) or
structured text/JSON. Every paid call settles on-chain in USDC via x402
(x402 v2 "exact" scheme, HTTP 402): the request is answered with a 402
challenge, you sign a gasless EIP-3009 transferWithAuthorization from your
wallet, and retry with the PAYMENT-SIGNATURE header. The CDP facilitator
verifies and settles — your wallet pays USDC only, no gas. No API keys, no
accounts.

## When to use

- Screenshot: PNG/JPEG/PDF of a live page, with a persistent public artifact URL.
- Structured data: title, headings, paragraphs, links, images, markdown — or schema-constrained extraction (natural-language \`schema\` field; model-backed when the deployment has a model configured).
- Monitoring: scheduled re-capture (watches at 15m/1h/6h/24h) with change detection, run history, and an optional webhook.

## Endpoints and prices

Base URL: ${config.publicBaseUrl}

| Purpose | Request | Price (USDC) |
| --- | --- | --- |
| Screenshot | POST /v1/x402/capture {"url", "format"?} | ${usdc(config.x402PriceUsdcUnits)} |
| Extract (batch of up to 10 URLs, one payment) | POST /v1/x402/extract {"url" or "urls", "schema"?} | ${usdc(config.x402ExtractPriceUsdcUnits)} |
| Watch top-up (100 runs) | POST /v1/x402/watches/topup {"watchId", "runs": 100} | ${usdc(watchTopUpPriceUsdcUnits('capture', config))} (capture watch) / ${usdc(watchTopUpPriceUsdcUnits('extract', config))} (extract watch) |
| Structured preview (truncated) | GET /v1/extract/preview?url=… | free, rate-limited per IP |
| OG metadata | GET /v1/og?url=… | free |

Machine-readable catalog: ${config.publicBaseUrl}/v1/x402/service · Full spec: ${config.publicBaseUrl}/openapi.json

## Quick start (Node.js, @x402/axios)

\`\`\`js
import axios from 'axios';
import { ExactEvmScheme } from '@x402/evm';
import { x402Client, wrapAxiosWithPayment } from '@x402/axios';
import { privateKeyToAccount } from 'viem/accounts';

const BASE = '${config.publicBaseUrl}';
const account = privateKeyToAccount(process.env.WALLET_KEY); // EOA holding USDC on Base
const client = new x402Client().register('${config.x402Network ?? 'eip155:8453'}', new ExactEvmScheme(account));
const api = wrapAxiosWithPayment(axios.create({ baseURL: BASE }), client);

// Screenshot — on 402 the client signs and retries for you (${usdc(config.x402PriceUsdcUnits)})
const shot = await api.post('/v1/x402/capture', { url: 'https://example.com', format: 'png' });
const pngBase64 = shot.data.artifact.data;
const artifactUrl = shot.data.artifact.url; // persistent, shareable

// Extract — one ${usdc(config.x402ExtractPriceUsdcUnits)} payment covers up to 10 urls
const page = await api.post('/v1/x402/extract', { url: 'https://example.com' });
const { title, headings, paragraphs, links, images } = page.data.results[0].data;
\`\`\`

## Raw EIP-3009 (no client library)

1. POST the endpoint with the JSON body → HTTP 402 challenge (JSON body; base64 in the PAYMENT-REQUIRED header).
2. Sign TransferWithAuthorization (EIP-712): from = your EOA, to = the challenge payTo, value = accepts[0].amount, nonce + validAfter/validBefore per EIP-3009; domain = the USDC contract (name + version from accepts[0].extra, chainId = the numeric suffix of accepts[0].network — eip155:8453 → 8453, verifyingContract = accepts[0].asset).
3. Retry the identical request with header PAYMENT-SIGNATURE: <base64 payment payload> (authorization + signature).

## Free preview (no wallet, no payment)

GET ${config.publicBaseUrl}/v1/extract/preview?url=https://example.com returns a truncated
structured preview (title, headings, links, a markdown slice) and is
rate-limited per IP — use it to peek at a page before paying; the paid
extract returns the full text plus images, batches, and optional model
extraction.

## Failure modes

- 402 again after retry: the authorization was rejected (wrong amount, payTo, network, signature, or expiry window) — fetch a fresh challenge and sign it again.
- 429 on the free preview: rate-limited — the 429 body's detail.paidUpgrade carries the paid next-step (endpoint POST /v1/x402/extract, price, howToPay, skill guide); wait a minute, or pay for extract.
- 502: the upstream page capture failed — nothing is charged when capture fails; retry later.
`;
}
