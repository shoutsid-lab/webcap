/**
 * The free / artifact / landing path docs: GET /v1/extract/preview,
 * GET /v1/artifacts/{id}, GET /v1/artifacts/{id}/page, GET /, GET /icon.png,
 * GET /openapi.json. Split out of openapi.ts as a pure move (no behavior
 * change); the key order within the table is preserved so the generated JSON
 * stays byte-identical.
 */
import { jsonContent, jsonError, type PathContext } from './shared.js';
import type { OpenapiPaths } from './types.js';

/** The free / artifact / landing path docs (the next six paths of the table). */
export function freePaths(ctx: PathContext): OpenapiPaths {
  return {
    '/v1/extract/preview': {
      get: {
        tags: ['extract'],
        summary: 'Free bounded structured preview (no payment, rate-limited)',
          description: `Sample the extract output without paying: a truncated preview (headings, links, first ${ctx.previewMarkdownLimit} chars of markdown). Rate-limited per client.`,
        parameters: [
          { name: 'url', in: 'query', required: true, schema: { type: 'string' }, description: 'The page to preview' },
        ],
        responses: {
          200: {
            description: 'Truncated structured preview + upgrade pointer to the paid endpoint',
            content: jsonContent({
              type: 'object',
              properties: {
                url: { type: 'string' },
                preview: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    description: { type: 'string' },
                    headings: { type: 'array', items: { type: 'object', properties: { level: { type: 'integer' }, text: { type: 'string' } } } },
                    links: { type: 'array', items: { type: 'object', properties: { href: { type: 'string' }, text: { type: 'string' } } } },
                    wordCount: { type: 'integer' },
                    markdown: { type: 'string', description: `First ${ctx.previewMarkdownLimit} characters of the document-order markdown` },
                  },
                },
                truncated: { type: 'boolean', example: true },
                upgrade: {
                  type: 'object',
                  properties: {
                    endpoint: { type: 'string', example: 'POST /v1/x402/extract' },
                    note: { type: 'string' },
                  },
                },
                trial: {
                  type: 'object',
                  properties: {
                    endpoint: { type: 'string', example: 'POST /v1/x402/trial' },
                    note: { type: 'string', description: 'Free trial pointer: one full PNG capture per wallet (EIP-191 personal_sign proof)' },
                  },
                },
                paidUpgrade: {
                  type: 'object',
                  properties: {
                    endpoint: { type: 'string', example: 'POST /v1/x402/extract', description: 'The paid extract endpoint (method + path) that returns the full result' },
                    priceUsdc: { type: 'number', example: 0.01, description: 'Per-extract price in USDC (priceUsdcUnits / 1e6), config-derived' },
                    priceUsdcUnits: { type: 'integer', example: 10000, description: 'Per-extract price in atomic 6-decimal USDC units (config x402ExtractPriceUsdcUnits)' },
                    howToPay: { type: 'string', description: 'The x402 v2 "exact" scheme payment flow: 402 challenge -> sign a gasless EIP-3009 USDC transferWithAuthorization -> retry with the PAYMENT-SIGNATURE header' },
                    guide: { type: 'string', description: 'The deployment agent skill guide URL (<public base URL>/skill.md), config-derived' },
                  },
                },
              },
            }),
          },
          422: ctx.unprocessable('Missing or invalid url query parameter'),
          429: jsonError('429', 'Preview rate limit exceeded (error envelope, code rate_limited; detail.retryAfterSeconds + detail.paidUpgrade{endpoint, priceUsdc, priceUsdcUnits, howToPay, guide} point at the paid extract endpoint)'),
          502: ctx.captureFailed,
        },
        security: [],
      },
    },
    '/v1/x402/trial': {
      post: {
        tags: ['capture'],
        summary: 'Free trial capture: one full PNG per wallet (EIP-191 proof, no payment)',
        description:
          'One free full-page PNG capture per wallet, proven by EIP-191 personal_sign of exactly ' +
          '"Claim one free webcap trial capture for <payer>" (<payer> = the lowercase 0x address). ' +
          'A wallet that already claimed gets 409 already_claimed. Rate-limited per client; ' +
          'the 200 and 409 responses carry a paidNext pointer at the paid capture endpoint. ' +
          'Never touches the revenue ledger. Free, no payment.',
        responses: {
          200: {
            description: 'Trial artifact + trial receipt + paidNext pointer',
            content: jsonContent({
              type: 'object',
              properties: {
                artifact: {
                  type: 'object',
                  properties: {
                    format: { type: 'string', example: 'png' },
                    bytes: { type: 'integer' },
                    data: { type: 'string', description: 'Base64 PNG bytes' },
                    url: { type: 'string', description: 'Persistent public artifact URL' },
                  },
                },
                trial: {
                  type: 'object',
                  properties: {
                    payer: { type: 'string' },
                    endpoint: { type: 'string', example: 'capture' },
                    priceUsdcUnits: { type: 'integer', example: 0 },
                  },
                },
                paidNext: {
                  type: 'object',
                  properties: {
                    endpoint: { type: 'string', example: 'POST /v1/x402/capture' },
                    priceUsdcUnits: { type: 'integer' },
                    guide: { type: 'string' },
                  },
                },
                remaining: { type: 'array', items: { type: 'string' } },
              },
            }),
          },
          401: jsonError('401', 'Trial signature invalid (malformed EIP-191 signature, or does not recover to payer)'),
          409: jsonError('409', 'Wallet already claimed its trial (code already_claimed; detail.paidNext points at the paid capture endpoint)'),
          422: ctx.unprocessable('Missing/invalid url, payer (must be a 0x EVM address), or signature'),
          429: jsonError('429', 'Trial rate limit exceeded (error envelope, code rate_limited; detail.paidNext points at the paid capture endpoint)'),
          502: ctx.captureFailed,
        },
        security: [],
      },
    },
    '/v1/x402/trial/extract': {
      post: {
        tags: ['capture'],
        summary: 'Free trial extract: one deterministic single-URL extraction per wallet',
        description:
          'Single URL only (urls/schema/model in the body answer 422 — batch + model live on the paid extract). ' +
          'Signature = EIP-191 personal_sign of exactly "Claim one free webcap trial extract for <payer>". ' +
          'Repeat claims 409 with paidNext + remaining. Never touches the revenue ledger. Free, no payment.',
        responses: {
          200: {
            description: 'Trial results + trial receipt + paidNext pointer',
            content: jsonContent({
              type: 'object',
              properties: {
                results: { type: 'array', items: { type: 'object' } },
                trial: {
                  type: 'object',
                  properties: {
                    payer: { type: 'string' },
                    endpoint: { type: 'string', example: 'extract' },
                    priceUsdcUnits: { type: 'integer', example: 0 },
                  },
                },
                paidNext: {
                  type: 'object',
                  properties: {
                    endpoint: { type: 'string', example: 'POST /v1/x402/extract' },
                    priceUsdcUnits: { type: 'integer' },
                    guide: { type: 'string' },
                  },
                },
                remaining: { type: 'array', items: { type: 'string' } },
              },
            }),
          },
          401: jsonError('401', 'Trial signature invalid (malformed EIP-191 signature, or does not recover to payer)'),
          409: jsonError('409', 'Wallet already claimed its extract trial (code already_claimed; detail carries paidNext + remaining)'),
          422: ctx.unprocessable('Missing/invalid url, payer, or signature — or a paid-only field (urls/schema/model) was sent'),
          429: jsonError('429', 'Trial rate limit exceeded (error envelope, code rate_limited)'),
          502: ctx.captureFailed,
        },
        security: [],
      },
    },
    '/v1/x402/trial/audit': {
      post: {
        tags: ['capture'],
        summary: 'Free trial audit: one SEO + link/OG health audit per wallet',
        description:
          'Full single-URL audit (title, description, OG tags, link health). ' +
          'Signature = EIP-191 personal_sign of exactly "Claim one free webcap trial audit for <payer>". ' +
          'Repeat claims 409 with paidNext + remaining. Never touches the revenue ledger. Free, no payment.',
        responses: {
          200: {
            description: 'Trial audit + trial receipt + paidNext pointer',
            content: jsonContent({
              type: 'object',
              properties: {
                audit: { type: 'object' },
                trial: {
                  type: 'object',
                  properties: {
                    payer: { type: 'string' },
                    endpoint: { type: 'string', example: 'audit' },
                    priceUsdcUnits: { type: 'integer', example: 0 },
                  },
                },
                paidNext: {
                  type: 'object',
                  properties: {
                    endpoint: { type: 'string', example: 'POST /v1/x402/audit' },
                    priceUsdcUnits: { type: 'integer' },
                    guide: { type: 'string' },
                  },
                },
                remaining: { type: 'array', items: { type: 'string' } },
              },
            }),
          },
          401: jsonError('401', 'Trial signature invalid (malformed EIP-191 signature, or does not recover to payer)'),
          409: jsonError('409', 'Wallet already claimed its audit trial (code already_claimed; detail carries paidNext + remaining)'),
          422: ctx.unprocessable('Missing/invalid url, payer (must be a 0x EVM address), or signature'),
          429: jsonError('429', 'Trial rate limit exceeded (error envelope, code rate_limited)'),
          502: ctx.captureFailed,
        },
        security: [],
      },
    },
    '/v1/x402/trial/map-lite': {
      post: {
        tags: ['capture'],
        summary: 'Free trial map-lite: one site map (capped at 10 URLs) per wallet',
        description:
          'Sitemap/robots + 1-hop same-host crawl, capped at 10 URLs (paid goes to 50). ' +
          'Signature = EIP-191 personal_sign of exactly "Claim one free webcap trial map-lite for <payer>". ' +
          'Repeat claims 409 with paidNext + remaining. Never touches the revenue ledger. Free, no payment.',
        responses: {
          200: {
            description: 'Trial URL list + trial receipt + paidNext pointer',
            content: jsonContent({
              type: 'object',
              properties: {
                urls: { type: 'array', items: { type: 'string' } },
                trial: {
                  type: 'object',
                  properties: {
                    payer: { type: 'string' },
                    endpoint: { type: 'string', example: 'map-lite' },
                    priceUsdcUnits: { type: 'integer', example: 0 },
                    maxUrlsCap: { type: 'integer', example: 10 },
                  },
                },
                paidNext: {
                  type: 'object',
                  properties: {
                    endpoint: { type: 'string', example: 'POST /v1/x402/map-lite' },
                    priceUsdcUnits: { type: 'integer' },
                    guide: { type: 'string' },
                  },
                },
                remaining: { type: 'array', items: { type: 'string' } },
              },
            }),
          },
          401: jsonError('401', 'Trial signature invalid (malformed EIP-191 signature, or does not recover to payer)'),
          409: jsonError('409', 'Wallet already claimed its map-lite trial (code already_claimed; detail carries paidNext + remaining)'),
          422: ctx.unprocessable('Missing/invalid url, payer (must be a 0x EVM address), signature, or maxUrls'),
          429: jsonError('429', 'Trial rate limit exceeded (error envelope, code rate_limited)'),
        },
        security: [],
      },
    },
    '/v1/x402/trial/analyze': {
      post: {
        tags: ['capture'],
        summary: 'Free trial analyze: one deterministic single-URL analysis per wallet',
        description:
          'Deterministic analysis only — no model call even when the deployment has a model configured ' +
          '(model-backed analysis stays paid). Body {url, task, payer, signature}; task is one of ' +
          'classification|accessibility|layout|entities|sentiment. ' +
          'Signature = EIP-191 personal_sign of exactly "Claim one free webcap trial analyze for <payer>". ' +
          'Repeat claims 409 with paidNext + remaining. Never touches the revenue ledger. Free, no payment.',
        responses: {
          200: {
            description: 'Trial analysis + trial receipt + paidNext pointer',
            content: jsonContent({
              type: 'object',
              properties: {
                task: { type: 'string', example: 'classification' },
                result: { type: 'object' },
                trial: {
                  type: 'object',
                  properties: {
                    payer: { type: 'string' },
                    endpoint: { type: 'string', example: 'analyze' },
                    priceUsdcUnits: { type: 'integer', example: 0 },
                  },
                },
                paidNext: {
                  type: 'object',
                  properties: {
                    endpoint: { type: 'string', example: 'POST /v1/x402/analyze' },
                    priceUsdcUnits: { type: 'integer' },
                    guide: { type: 'string' },
                  },
                },
                remaining: { type: 'array', items: { type: 'string' } },
              },
            }),
          },
          401: jsonError('401', 'Trial signature invalid (malformed EIP-191 signature, or does not recover to payer)'),
          409: jsonError('409', 'Wallet already claimed its analyze trial (code already_claimed; detail carries paidNext + remaining)'),
          422: ctx.unprocessable('Missing/invalid url, task, payer (must be a 0x EVM address), or signature'),
          429: jsonError('429', 'Trial rate limit exceeded (error envelope, code rate_limited)'),
          502: ctx.captureFailed,
        },
        security: [],
      },
    },
    '/v1/x402/trial/status': {
      get: {
        tags: ['discovery'],
        summary: 'Trial menu for a wallet: claimed/available trials + the claim recipe',
        parameters: [
          { name: 'payer', in: 'query', required: true, schema: { type: 'string' }, description: 'Lowercase 0x EVM address to look up' },
        ],
        responses: {
          200: {
            description: 'Claimed + available trial endpoints with trial/paid paths, prices, and howToClaim',
            content: jsonContent({
              type: 'object',
              properties: {
                payer: { type: 'string' },
                claimed: { type: 'array', items: { type: 'string' } },
                available: { type: 'array', items: { type: 'object' } },
                howToClaim: { type: 'object' },
              },
            }),
          },
          422: ctx.unprocessable('payer query parameter must be a 0x EVM address'),
        },
        security: [],
      },
    },
    '/v1/x402/trial/quick': {
      get: {
        tags: ['capture'],
        summary: 'No-wallet free JPEG thumbnail (3/day per IP)',
        description:
          'Zero-friction hook for bots that cannot sign: a JPEG capture thumbnail with no wallet and no ' +
          'signature, budgeted at 3 per IP per UTC day (429 faucet_exhausted past that, with a trial pointer). ' +
          'The full trials above are the product; this points at them. Free, no payment.',
        parameters: [
          { name: 'url', in: 'query', required: true, schema: { type: 'string' }, description: 'The page to thumbnail' },
        ],
        responses: {
          200: {
            description: 'Thumbnail artifact + faucet budget state + trial pointer',
            content: jsonContent({
              type: 'object',
              properties: {
                artifact: {
                  type: 'object',
                  properties: {
                    format: { type: 'string', example: 'jpeg' },
                    bytes: { type: 'integer' },
                    data: { type: 'string', description: 'Base64 JPEG bytes' },
                    url: { type: 'string', description: 'Persistent public artifact URL' },
                  },
                },
                faucet: { type: 'object' },
                trial: { type: 'object' },
                paidNext: { type: 'object' },
              },
            }),
          },
          422: ctx.unprocessable('url query parameter is required (or the URL is blocked/malformed)'),
          429: jsonError('429', 'Faucet budget spent for today (code faucet_exhausted; detail carries the wallet-trial pointer + paidNext)'),
          502: ctx.captureFailed,
        },
        security: [],
      },
    },
    '/og-debugger': {
      get: {
        tags: ['discovery'],
        summary: 'Free OG meta debugger tool page (no payment, rate-limited)',
        description:
          'Server-rendered link-preview debugger: omit url for the empty form, or pass ?url=… to see the Open Graph ' +
          '/ meta tags the free GET /v1/og endpoint returns for that page — a preview card plus a tag table, or an ' +
          'inline error for bad/unreachable URLs. Plain GET form, no JavaScript. Fetch is rate-limited per client.',
        parameters: [
          { name: 'url', in: 'query', required: false, schema: { type: 'string' }, description: 'The page to debug; omit for the empty form' },
        ],
        responses: {
          200: { description: 'The debugger page (text/html; charset=utf-8)', content: { 'text/html': { schema: { type: 'string' } } } },
        },
        security: [],
      },
    },
    '/v1/artifacts/{id}': {
      get: {
        tags: ['artifacts'],
        summary: 'Fetch a stored artifact (raw bytes, public)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: {
            description: 'The artifact bytes with its stored mime type (image/png, image/jpeg or application/pdf)',
            content: {
              'image/png': { schema: { type: 'string', format: 'binary' } },
              'image/jpeg': { schema: { type: 'string', format: 'binary' } },
              'application/pdf': { schema: { type: 'string', format: 'binary' } },
            },
          },
          404: jsonError('404', 'Artifact not found (error envelope, code not_found)'),
          403: jsonError('403', 'Signed URL signature mismatch (error envelope, code forbidden)'),
          410: jsonError('410', 'Signed URL expired (error envelope, code gone)'),
        },
        security: [],
      },
    },
    '/v1/artifacts/{id}/page': {
      get: {
        tags: ['artifacts'],
        summary: 'Shareable HTML page for an artifact (Open Graph tags, public)',
        description:
          'Renders the capture with og:title/og:description/og:type/og:url/og:image (og:url and og:image are the ' +
          'artifact public URL), the embedded image, the source URL, and format/size/captured-at metadata.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'The artifact page (text/html; charset=utf-8)', content: { 'text/html': { schema: { type: 'string' } } } },
          404: jsonError('404', 'Artifact not found (error envelope, code not_found)'),
        },
        security: [],
      },
    },
    '/': {
      get: {
        tags: ['discovery'],
        summary: 'Product landing page (content-negotiated)',
        description:
          'Returns the product landing page (text/html; charset=utf-8). Clients that send Accept: application/json ' +
          'without text/html receive the JSON service map instead (endpoints, prices, payment status).',
        responses: {
          200: {
            description: 'Landing page for HTML clients; JSON service map for pure-JSON clients',
            content: {
              'text/html': { schema: { type: 'string' } },
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    service: { type: 'string', example: 'webcap' },
                    tagline: { type: 'string' },
                    endpoints: { type: 'object', properties: { free: { type: 'array' }, paid: { type: 'array' } } },
                    catalog: { type: 'string' },
                    agentGuide: { type: 'string' },
                    payment: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        security: [],
      },
    },
    '/quickstart': {
      get: {
        tags: ['discovery'],
        summary: 'Quick start guide — step-by-step walkthrough from free preview to paid API',
        description:
          'Server-rendered quick start guide that walks developers through the entire flow: ' +
          'free preview, x402 payment challenge, client library, wallet setup. ' +
          'Reduces conversion friction by providing copy-paste commands.',
        responses: {
          200: { description: 'The quick start guide page (text/html; charset=utf-8)', content: { 'text/html': { schema: { type: 'string' } } } },
        },
        security: [],
      },
    },
    '/compare': {
      get: {
        tags: ['discovery'],
        summary: 'Pricing comparison page — webcap vs alternatives',
        description:
          'Server-rendered comparison page showing webcap pricing against SaaS alternatives. ' +
          'Highlights the cost advantage of pay-per-call with no subscriptions.',
        responses: {
          200: { description: 'The comparison page (text/html; charset=utf-8)', content: { 'text/html': { schema: { type: 'string' } } } },
        },
        security: [],
      },
    },
    '/buy': {
      get: {
        tags: ['discovery'],
        summary: 'Buy credits page — credit pack purchase with card and crypto',
        description:
          'Server-rendered credit pack purchase page with three tiers (Starter $0.50, Pro $3, Max $12). ' +
          'Shows pricing, credit usage, and payment instructions for both Stripe card and x402 crypto payments.',
        responses: {
          200: { description: 'The buy credits page (text/html; charset=utf-8)', content: { 'text/html': { schema: { type: 'string' } } } },
        },
        security: [],
      },
    },
    '/v1/stripe/checkout': {
      post: {
        tags: ['discovery'],
        summary: 'Create a Stripe Checkout session for credit pack purchase',
        description:
          'Creates a Stripe Checkout session for buying credit packs (Starter $0.50, Pro $3, Max $12). ' +
          'When Stripe is not configured, returns a helpful error with alternative payment instructions (x402 crypto or email purchase).',
        requestBody: {
          required: true,
          content: jsonContent({
            type: 'object',
            required: ['pack'],
            properties: {
              pack: { type: 'string', enum: ['starter', 'pro', 'max'], description: 'Credit pack to purchase' },
              address: { type: 'string', description: 'Optional Ethereum address to associate with the purchase' },
            },
          }),
        },
        responses: {
          200: {
            description: 'Stripe Checkout session URL (when configured) or payment alternatives (when not configured)',
            content: jsonContent({
              oneOf: [
                {
                  type: 'object',
                  properties: {
                    checkoutUrl: { type: 'string', format: 'uri', description: 'URL to redirect to Stripe Checkout' },
                  },
                },
                {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'stripe_not_configured' },
                    message: { type: 'string' },
                    fallback: {
                      type: 'object',
                      properties: {
                        crypto: { type: 'string' },
                        email: { type: 'string' },
                      },
                    },
                  },
                },
              ],
            }),
          },
          422: ctx.unprocessable('Missing or invalid pack field'),
        },
        security: [],
      },
    },
    '/v1/demo': {
      get: {
        tags: ['discovery'],
        summary: 'Sample full extract response (no payment, no rate limit)',
        description:
          'Returns a hardcoded example extract response so users can see the actual JSON output format ' +
          'before paying. Useful for understanding the API response structure.',
        responses: {
          200: {
            description: 'Sample extract response with _demo flag',
            content: jsonContent({
              type: 'object',
              properties: {
                url: { type: 'string', example: 'https://example.com/' },
                results: { type: 'array', items: { type: 'object' } },
                _demo: { type: 'boolean', example: true },
                _note: { type: 'string' },
              },
            }),
          },
        },
        security: [],
      },
    },
    '/icon.png': {
      get: {
        tags: ['discovery'],
        summary: 'Service icon (PNG)',
        responses: {
          200: { description: 'The webcap icon', content: { 'image/png': { schema: { type: 'string', format: 'binary' } } } },
          500: jsonError('500', 'Icon file missing on the server (error envelope, code internal)'),
        },
        security: [],
      },
    },
    '/openapi.json': {
      get: {
        tags: ['discovery'],
        summary: 'This OpenAPI catalog',
        responses: {
          200: { description: 'The OpenAPI 3.1 document', content: jsonContent({ $ref: '#/components/schemas/OpenapiDocument' }) },
        },
        security: [],
      },
    },
    '/v1/status': {
      get: {
        tags: ['discovery'],
        summary: 'Operational status dashboard (uptime, revenue totals, hit counts)',
        description:
          'Public, non-sensitive operational snapshot: server uptime, chain config, DB health, ' +
          'aggregate revenue totals (no payer-identifiable data), top endpoint hit counts, ' +
          'active watch count, and artifact count. Designed for status pages and monitoring.',
        responses: {
          200: {
            description: 'Operational status snapshot',
            content: jsonContent({
              type: 'object',
              properties: {
                status: { type: 'string', example: 'ok' },
                uptimeSeconds: { type: 'integer', description: 'Seconds since server start' },
                version: { type: 'string', example: '0.1.0' },
                chain: {
                  type: 'object',
                  properties: {
                    id: { type: 'integer', example: 8453 },
                    name: { type: 'string', example: 'base' },
                    network: { type: 'string', example: 'eip155:8453' },
                  },
                },
                db: { type: 'object', properties: { ok: { type: 'boolean' } } },
                pricing: {
                  type: 'object',
                  properties: {
                    creditsPerUsdc: { type: 'integer' },
                    pricePerCredit: { type: 'number' },
                  },
                },
                revenue: {
                  type: 'object',
                  properties: {
                    totalRevenueUsdcUnits: { type: 'integer' },
                    totalCostUsdcUnits: { type: 'integer' },
                    netMarginUsdcUnits: { type: 'integer' },
                    requestCount: { type: 'integer' },
                  },
                },
                endpoints: {
                  type: 'object',
                  properties: {
                    topHits: { type: 'array', items: { type: 'object', properties: { endpoint: { type: 'string' }, hits: { type: 'integer' } } } },
                  },
                },
                watches: { type: 'object', properties: { active: { type: 'integer' } } },
                artifacts: { type: 'object', properties: { count: { type: 'integer' } } },
              },
            }),
          },
        },
        security: [],
      },
    },
    '/v1/funnel': {
      get: {
        tags: ['discovery'],
        summary: 'Conversion funnel analytics (last 24h)',
        description:
          'Structured conversion funnel with stage-by-stage conversion rates, hourly breakdown, referrer sources, ' +
          'error type breakdown, and waitlist count. Pass ?format=text for human-readable terminal output (no jq needed). ' +
          'Public, non-sensitive analytics for monitoring landing page performance.',
        parameters: [
          { name: 'format', in: 'query', required: false, schema: { type: 'string', enum: ['json', 'text'] }, description: 'Response format: json (default) or text for terminal-friendly output' },
        ],
        responses: {
          200: {
            description: 'Funnel analytics data',
            content: jsonContent({
              type: 'object',
              properties: {
                generatedAt: { type: 'string', format: 'date-time' },
                waitlistCount: { type: 'integer' },
                funnel: { type: 'object', additionalProperties: { type: 'integer' }, description: 'Raw event counts by event name' },
                funnelStructured: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      stage: { type: 'string', example: 'page_view' },
                      count: { type: 'integer' },
                      conversionFromPrev: { type: ['number', 'null'], description: 'Percentage from previous stage, null for first/error stages' },
                    },
                  },
                },
                funnelHourly: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      hour: { type: 'string', example: '2026-09-09T14:00:00Z' },
                      events: { type: 'object', additionalProperties: { type: 'integer' } },
                    },
                  },
                },
                funnelReferrers: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      referrer: { type: 'string', example: 'hacker_news' },
                      count: { type: 'integer' },
                    },
                  },
                },
                errorBreakdown: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      errorType: { type: 'string', example: 'capture_failed_502' },
                      count: { type: 'integer' },
                      sampleUrls: { type: 'array', items: { type: 'string' } },
                    },
                  },
                },
              },
            }),
          },
        },
        security: [],
      },
    },
    '/v1/status-badge': {
      get: {
        tags: ['discovery'],
        summary: 'Shields.io-compatible status badge endpoint',
        description:
          'Returns a shields.io-compatible JSON response for embedding a live API status badge in README files. ' +
          'Returns operational status based on DB health check.',
        responses: {
          200: {
            description: 'Status badge data',
            content: jsonContent({
              type: 'object',
              properties: {
                schemaVersion: { type: 'integer', example: 1 },
                label: { type: 'string', example: 'API Status' },
                message: { type: 'string', example: 'operational' },
                color: { type: 'string', example: 'brightgreen' },
              },
            }),
          },
        },
        security: [],
      },
    },
    '/v1/waitlist': {
      post: {
        tags: ['discovery'],
        summary: 'Join the email waitlist',
        description:
          'Stores an email address for the waitlist/mailing list. ' +
          'No auth required; fire-and-forget from the landing page.',
        requestBody: {
          required: true,
          content: jsonContent({
            type: 'object',
            required: ['email'],
            properties: {
              email: { type: 'string', format: 'email', description: 'Email address to add to the waitlist' },
            },
          }),
        },
        responses: {
          200: {
            description: 'Email added to waitlist',
            content: jsonContent({
              type: 'object',
              properties: {
                ok: { type: 'boolean', example: true },
                message: { type: 'string', example: 'Added to waitlist' },
              },
            }),
          },
          422: ctx.unprocessable('Missing or invalid email field'),
        },
        security: [],
      },
    },
    '/v1/track': {
      post: {
        tags: ['discovery'],
        summary: 'Lightweight landing page event tracking (fire-and-forget)',
        description:
          'Records page views, preview form submissions, and other conversion events for analytics. ' +
          'No auth required; fire-and-forget from client-side JavaScript.',
        requestBody: {
          required: true,
          content: jsonContent({
            type: 'object',
            required: ['event'],
            properties: {
              event: { type: 'string', description: 'Event name (e.g., landing_view, preview_submit)' },
              meta: { type: 'object', description: 'Optional event metadata' },
            },
          }),
        },
        responses: {
          200: {
            description: 'Event recorded',
            content: jsonContent({
              type: 'object',
              properties: {
                ok: { type: 'boolean', example: true },
                event: { type: 'string' },
              },
            }),
          },
          422: ctx.unprocessable('Missing or invalid event field'),
        },
        security: [],
      },
    },
  };
}
