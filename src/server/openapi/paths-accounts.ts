/**
 * The credits-rail (API-key account) path docs: POST /v1/register,
 * POST /v1/invoice, POST /v1/capture, GET /v1/ledger, GET /v1/account —
 * plus GET /v1/og, which sits between /v1/ledger and /v1/account in the
 * original table and stays here so the key order (and thus the generated
 * JSON) is byte-identical. Split out of openapi.ts as a pure move (no
 * behavior change).
 */
import { CAPTURE_COST_CREDITS, usdcForCredits, type WebcapConfig } from '../../config.js';
import { captureCreditResponse, captureRequestBody } from './schemas.js';
import { jsonContent, jsonError, type PathContext } from './shared.js';
import type { OpenapiPaths } from './types.js';

/** The credits-rail path docs (the last six paths of the table). */
export function accountPaths(config: WebcapConfig, ctx: PathContext): OpenapiPaths {
  return {
    '/v1/register': {
      post: {
        tags: ['accounts'],
        summary: 'Register a wallet and mint an API key (free, no auth)',
        description:
          'Idempotent per address: an existing account gets a fresh API key instead of a duplicate account. ' +
          'No payment: buy credits via POST /v1/invoice, or skip accounts entirely and pay per call over x402.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['address'],
                properties: {
                  address: { type: 'string', description: 'Ethereum address (hex, checksummed or not)' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Registered; {address, apiKey, balance}',
            content: jsonContent({
              type: 'object',
              properties: {
                address: { type: 'string' },
                apiKey: { type: 'string', description: 'Send as "Authorization: Bearer <key>" on subsequent requests' },
                balance: { type: 'integer', example: 0 },
              },
            }),
          },
          422: ctx.unprocessable('Missing or invalid address'),
        },
        security: [],
      },
    },
    '/v1/invoice': {
      post: {
        tags: ['accounts'],
        summary: 'Create a USDC credit invoice (manual ERC-20 transfer)',
        description:
          `Buy credits as USDC sent from your own wallet to the merchant address: the invoice names the token, the ` +
          `recipient, and the required amount for the chosen credit amount (credits omitted = 100). The API-key ` +
          `alternative to x402's per-call payment.`,
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  credits: { type: 'integer', description: 'Credits to buy (default 100)', example: 100 },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Created; the USDC transfer details',
            content: jsonContent({
              type: 'object',
              properties: {
                invoiceId: { type: 'string' },
                merchant: { type: 'string', description: 'Send the USDC to this address' },
                token: { type: 'string', description: 'USDC ERC-20 contract' },
                chainId: { type: 'integer', example: config.chain.chainId },
                requiredUsdc: { type: 'number', example: usdcForCredits(100) },
                credits: { type: 'integer', example: 100 },
                expiresAt: { type: 'string' },
              },
            }),
          },
          401: ctx.unauthorized,
          422: ctx.unprocessable('credits must be a positive integer'),
        },
      },
    },
    '/v1/capture': {
      post: {
        tags: ['accounts'],
        summary: `Capture a URL as a screenshot (paid, ${CAPTURE_COST_CREDITS} credit per call)`,
        description:
          'The credit-metered front door: charges 1 credit per capture (refunded when the capture fails). ' +
          'Prefer the x402 route for gasless USDC payment without an account.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: captureRequestBody } },
        },
        responses: {
          200: { description: 'The artifact (base64) + its canonical public URL, plus the credit charge and remaining balance', content: jsonContent(captureCreditResponse) },
          401: ctx.unauthorized,
          402: jsonError('402', 'Insufficient credits; the error detail carries a top-up invoice (error envelope, code insufficient_credits)'),
          422: ctx.unprocessable('Invalid input: missing/invalid url, format or options'),
          502: ctx.captureFailed,
        },
      },
    },
    '/v1/ledger': {
      get: {
        tags: ['accounts'],
        summary: 'Merchant revenue ledger (summary + last 50 paid requests)',
        description: 'Merchant-only: the P&L summary plus the 50 most recent paid requests (endpoint, payer, revenue and cost in USDC units).',
        responses: {
          200: {
            description: 'Revenue summary + recent entries',
            content: jsonContent({
              type: 'object',
              properties: {
                summary: { type: 'object' },
                recent: { type: 'array', items: { type: 'object' } },
              },
            }),
          },
          401: ctx.unauthorized,
          403: jsonError('403', 'The authenticated account is not the merchant (error envelope, code forbidden)'),
        },
      },
    },
    '/v1/og': {
      get: {
        tags: ['discovery'],
        summary: 'Free Open Graph metadata for a URL (no payment)',
        description:
          'Fetch the page and return its og:title/og:description/og:image (falling back to the <title> tag and ' +
          'icon link for title/image). Free, no payment and no API key.',
        parameters: [
          { name: 'url', in: 'query', required: true, schema: { type: 'string' }, description: 'The page to fetch' },
        ],
        responses: {
          200: {
            description: 'The Open Graph metadata (absent fields are omitted)',
            content: jsonContent({
              type: 'object',
              required: ['url'],
              properties: {
                url: { type: 'string' },
                title: { type: 'string' },
                description: { type: 'string' },
                image: { type: 'string' },
                icon: { type: 'string' },
              },
            }),
          },
          422: ctx.unprocessable('Missing or invalid url query parameter'),
          502: ctx.captureFailed,
        },
        security: [],
      },
    },
    '/v1/account': {
      get: {
        tags: ['accounts'],
        summary: 'Account balance + invoice history',
        responses: {
          200: {
            description: 'The address, credit balance, and the account\'s invoices',
            content: jsonContent({
              type: 'object',
              properties: {
                address: { type: 'string' },
                balance: { type: 'integer', description: 'Credits remaining' },
                invoices: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      status: { type: 'string' },
                      credits: { type: 'number' },
                      requiredUsdc: { type: 'number' },
                      createdAt: { type: 'string' },
                    },
                  },
                },
              },
            }),
          },
          401: ctx.unauthorized,
        },
      },
    },
  };
}
