/**
 * The web discovery path docs: GET /v1/x402/service, GET /v1/health,
 * GET /robots.txt, GET /sitemap.xml, GET /.well-known/x402,
 * GET /.well-known/agent-card.json, GET /llms.txt, GET /skill.md. Split out
 * of openapi.ts as a pure move (no behavior change); the key order within
 * the table is preserved so the generated JSON stays byte-identical (the two
 * agent-surface paths were appended last, after the pre-existing keys).
 */
import {
  CREDITS_PER_USDC,
  PRICE_PER_CREDIT,
  USDC_SCALE,
  WATCH_TOPUP_RUNS,
  watchTopUpPriceUsdcUnits,
  type WebcapConfig,
} from '../../config.js';
import { jsonContent, jsonError } from './shared.js';
import type { OpenapiPaths } from './types.js';

/** The web discovery path docs (the next six paths of the table). */
export function webPaths(config: WebcapConfig): OpenapiPaths {
  return {
    '/v1/x402/service': {
      get: {
        tags: ['discovery'],
        summary: 'Agent-discoverable x402 service descriptor',
        description:
          'Full descriptor of the paid endpoints, the x402 v2 "exact" scheme, the USDC asset, payTo, the facilitator ' +
          'and howToPay, plus the free endpoints. 503 when x402 is disabled on this deployment.',
        responses: {
          200: {
            description: 'The x402 service descriptor (paid endpoints, price, howToPay, free endpoints)',
            content: jsonContent({
              type: 'object',
              properties: {
                service: { type: 'string', example: 'webcap' },
                paymentProtocol: { type: 'string', example: 'x402' },
                x402Version: { type: 'integer', example: 2 },
                paidEndpoints: { type: 'array', items: { type: 'object' } },
                price: {
                  type: 'object',
                  properties: {
                    asset: { type: 'string' },
                    network: { type: 'string' },
                    payTo: { type: 'string' },
                    scheme: { type: 'string', example: 'exact' },
                  },
                },
                howToPay: { type: 'string' },
                facilitator: { type: 'string' },
                freeEndpoints: { type: 'array', items: { type: 'object' } },
              },
            }),
          },
          503: jsonError('503', 'x402 disabled on this deployment (WEBCAP_CHAIN=local)'),
        },
      },
    },
    '/v1/health': {
      get: {
        tags: ['discovery'],
        summary: 'Liveness + chain identity',
        responses: {
          200: {
            description: 'Liveness probe: ok, chainId, creditsPerUsdc, pricePerCredit',
            content: jsonContent({
              type: 'object',
              properties: {
                ok: { type: 'boolean', example: true },
                chainId: { type: 'integer', example: config.chain.chainId },
                creditsPerUsdc: { type: 'integer', example: CREDITS_PER_USDC },
                pricePerCredit: { type: 'number', example: PRICE_PER_CREDIT },
              },
            }),
          },
        },
      },
    },
    '/robots.txt': {
      get: {
        tags: ['discovery'],
        summary: 'Crawler directives (allows all; points to the sitemap)',
        responses: {
          200: {
            description: 'text/plain; charset=utf-8 — User-agent: * / Allow: / / Sitemap: <base>/sitemap.xml',
            content: { 'text/plain': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/sitemap.xml': {
      get: {
        tags: ['discovery'],
        summary: 'XML sitemap of the stable public paths (https-absolute)',
        responses: {
          200: {
            description: 'application/xml; charset=utf-8 — one <loc> per public path, protocol-absolute https',
            content: { 'application/xml': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/.well-known/x402': {
      get: {
        tags: ['discovery'],
        summary: 'x402 machine-discovery catalog (endpoints, USDC prices, payTo, facilitator)',
        description:
          `What to call and what it costs: the paid endpoints with their USDC prices (the watch top-up shows the ` +
          `capture-mode pack price as usdc and the extract-mode pack price as usdcMax; the exact pack price is quoted ` +
          `per watch via ?watchId=), the free endpoints, and links to this catalog and the sitemap. network/asset/payTo ` +
          'are null when x402 is disabled on this deployment.',
        responses: {
          200: {
            description: 'The x402 discovery catalog',
            content: jsonContent({
              type: 'object',
              properties: {
                service: { type: 'string', example: 'webcap' },
                description: { type: 'string' },
                network: { type: ['string', 'null'], example: config.x402Network ?? null },
                asset: { type: ['string', 'null'], example: config.x402Network === undefined ? null : config.x402Asset },
                payTo: { type: ['string', 'null'], example: config.x402Network === undefined ? null : config.x402PayTo },
                facilitator: { type: 'string', example: config.x402FacilitatorUrl },
                endpoints: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      path: { type: 'string', example: 'POST /v1/x402/capture' },
                      usdc: { type: 'number', example: config.x402PriceUsdcUnits / USDC_SCALE },
                      usdcMax: {
                        type: 'number',
                        description: 'Top-up route only: the extract-mode pack price',
                        example: watchTopUpPriceUsdcUnits('extract', config) / USDC_SCALE,
                      },
                      description: { type: 'string' },
                    },
                  },
                },
                free: {
                  type: 'array',
                  items: { type: 'object', properties: { path: { type: 'string' }, note: { type: 'string' } } },
                },
                openapi: { type: 'string', description: 'This catalog, https-absolute' },
                sitemap: { type: 'string', description: 'The sitemap, https-absolute' },
                ownershipProofs: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'EIP-191 personal_sign of the service origin, signed by the payTo key; x402scan verified-ownership',
                },
              },
            }),
          },
        },
      },
    },
    '/.well-known/agent-card.json': {
      get: {
        tags: ['discovery'],
        summary: 'A2A-style agent card with the x402 payments section',
        description:
          'One document for agent-card consumers: service capabilities and the x402 payment parameters ' +
          '(network, asset, payTo, facilitator). network/asset/payTo are null when x402 is disabled.',
        responses: {
          200: {
            description: 'The agent card (application/json; charset=utf-8)',
            content: jsonContent({
              type: 'object',
              properties: {
                protocolVersion: { type: 'string', example: '0.3.0' },
                name: { type: 'string', example: 'webcap' },
                description: { type: 'string' },
                url: { type: 'string' },
                icon: { type: 'string' },
                version: { type: 'string', example: '1.0.0' },
                roles: { type: 'array', items: { type: 'string' }, example: ['merchant'] },
                capabilities: {
                  type: 'object',
                  properties: { streaming: { type: 'boolean' }, pushNotifications: { type: 'boolean' } },
                },
                authentication: {
                  type: 'object',
                  properties: { schemes: { type: 'array', items: { type: 'string' }, example: ['x402'] } },
                },
                payments: {
                  type: 'object',
                  properties: {
                    provider: { type: 'string', example: 'x402' },
                    network: { type: ['string', 'null'], example: config.x402Network ?? null },
                    asset: { type: ['string', 'null'], example: config.x402Network === undefined ? null : config.x402Asset },
                    payTo: { type: ['string', 'null'], example: config.x402Network === undefined ? null : config.x402PayTo },
                    facilitator: { type: 'string', example: config.x402FacilitatorUrl },
                  },
                },
                skills: { type: 'array', items: { type: 'object' } },
              },
            }),
          },
        },
      },
    },
    '/llms.txt': {
      get: {
        tags: ['discovery'],
        summary: 'llms.txt convention document for LLM agents (markdown)',
        description:
          'The llms.txt document: what webcap is, how to pay (x402, USDC on Base, gasless EIP-3009, CDP ' +
          'facilitator), the paid endpoints with prices and request/response shapes, the free endpoints, ' +
          'pointers to /v1/x402/service and /openapi.json, and a minimal x402 payment flow. Free, no payment.',
        responses: {
          200: {
            description: 'text/markdown; charset=utf-8 — the llms.txt document (base URL and prices from config)',
            content: { 'text/markdown': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/skill.md': {
      get: {
        tags: ['discovery'],
        summary: 'Installable agent skill file (markdown with YAML frontmatter)',
        description:
          'An agent skill (name: webcap) teaching how to call webcap with an x402 client (@x402/axios quick ' +
          'start, raw EIP-3009 fallback), with the pricing table and the free-preview alternative. Free, no payment.',
        responses: {
          200: {
            description: 'text/markdown; charset=utf-8 — YAML frontmatter (name, description) + usage instructions',
            content: { 'text/markdown': { schema: { type: 'string' } } },
          },
        },
      },
    },
  };
}
