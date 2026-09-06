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
          429: jsonError('429', 'Preview rate limit exceeded; use the paid extract endpoint (error envelope, code rate_limited)'),
          502: ctx.captureFailed,
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
  };
}
