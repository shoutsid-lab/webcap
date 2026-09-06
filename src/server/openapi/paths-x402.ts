/**
 * The x402 paid-route path docs (plus the free monitoring routes they
 * monetize): POST /v1/x402/capture, POST /v1/x402/extract, POST /v1/watches,
 * GET/DELETE /v1/watches/{id}, POST /v1/x402/watches/topup. Split out of
 * openapi.ts as a pure move (no behavior change); the key order within the
 * table is preserved so the generated JSON stays byte-identical.
 */
import { USDC_SCALE, WATCH_TOPUP_RUNS, watchTopUpPriceUsdcUnits, type WebcapConfig } from '../../config.js';
import {
  auditRequestBody,
  auditResponse,
  captureRequestBody,
  captureResponse,
  extractRequestBody,
  extractResponse,
  watchCreateBody,
  watchStateResponse,
  watchTopUpBody,
  watchTopUpResponse,
} from './schemas.js';
import { jsonContent, jsonError, x402Challenge, type PathContext } from './shared.js';
import type { OpenapiPaths } from './types.js';

/** 6-decimal USDC amount as the fixed-point string mppscan's x-payment-info expects (1000 -> '0.001000'). */
const usdAmount = (units: number): string => (units / USDC_SCALE).toFixed(6);

/** The x402 paid-route path docs (the first five paths of the table). */
export function x402Paths(config: WebcapConfig, ctx: PathContext): OpenapiPaths {
  return {
    '/v1/x402/capture': {
      post: {
        tags: ['capture'],
        summary: 'Capture a URL as a screenshot (paid, x402)',
        description:
          'Capture the URL as a PNG/JPEG/PDF screenshot plus free OG metadata. Unpaid requests receive the ' +
          'x402 402 challenge; paying clients retry with PAYMENT-SIGNATURE. One payment per URL. ' +
          'Optional options tune the render: viewport {width, height}, deviceScaleFactor, isMobile, userAgent, plus timeoutMs/fullPage.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: captureRequestBody } },
        },
        responses: {
          200: { description: 'Paid + settled; the artifact (base64) and its canonical public URL', content: jsonContent(captureResponse(config.x402PriceUsdcUnits)) },
          402: x402Challenge(config, { priceUsdcUnits: config.x402PriceUsdcUnits, resourcePath: '/v1/x402/capture' }),
          400: ctx.badInput,
          422: ctx.unprocessable('Invalid input: missing/invalid url, format or options'),
          502: ctx.captureFailed,
          503: jsonError('503', 'x402 disabled on this deployment (WEBCAP_CHAIN=local)'),
        },
        'x-payment-info': {
          price: { mode: 'fixed', currency: 'USD', amount: usdAmount(config.x402PriceUsdcUnits) },
          protocols: [{ x402: {} }, { mpp: { method: 'evm' } }],
        },
      },
    },
    '/v1/x402/extract': {
      post: {
        tags: ['extract'],
        summary: 'Extract structured content from one URL or a batch (paid, x402)',
        description:
          'Return structured content (title, headings, paragraphs, links, images, word count, markdown) as JSON. ' +
          `Batch up to 10 URLs for ONE payment (${config.x402ExtractPriceUsdcUnits / USDC_SCALE} USDC covers the whole batch). ` +
          'Optional natural-language "schema" triggers model-based extraction into custom JSON.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: extractRequestBody } },
        },
        responses: {
          200: { description: 'Paid + settled; per-URL results (ok/error)', content: jsonContent(extractResponse(config.x402ExtractPriceUsdcUnits)) },
          402: x402Challenge(config, { priceUsdcUnits: config.x402ExtractPriceUsdcUnits, resourcePath: '/v1/x402/extract' }),
          400: ctx.badInput,
          422: ctx.unprocessable('Invalid input: missing/invalid url(s) or schema'),
          502: jsonError('502', 'All URLs in the batch failed to extract (error envelope, code extract_failed)'),
          503: jsonError('503', 'x402 disabled on this deployment (WEBCAP_CHAIN=local)'),
        },
        'x-payment-info': {
          price: { mode: 'fixed', currency: 'USD', amount: usdAmount(config.x402ExtractPriceUsdcUnits) },
          protocols: [{ x402: {} }, { mpp: { method: 'evm' } }],
        },
      },
    },
    '/v1/x402/audit': {
      post: {
        tags: ['audit'],
        summary: 'Audit a URL for SEO, OG tags, and link health (paid, x402)',
        description:
          'Audit one URL for SEO signals, Open Graph presence, and link health via a single captureStructured call. ' +
          'Unpaid requests receive the x402 402 challenge; paying clients retry with PAYMENT-SIGNATURE. One payment per URL.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: auditRequestBody } },
        },
        responses: {
          200: { description: 'Paid + settled; the audit report', content: jsonContent(auditResponse(config.x402AuditPriceUsdcUnits)) },
          402: x402Challenge(config, { priceUsdcUnits: config.x402AuditPriceUsdcUnits, resourcePath: '/v1/x402/audit' }),
          400: ctx.badInput,
          422: ctx.unprocessable('Invalid input: missing/invalid url'),
          502: jsonError('502', 'Audit failed for the URL (error envelope, code audit_failed)'),
          503: jsonError('503', 'x402 disabled on this deployment (WEBCAP_CHAIN=local)'),
        },
        'x-payment-info': {
          price: { mode: 'fixed', currency: 'USD', amount: usdAmount(config.x402AuditPriceUsdcUnits) },
          protocols: [{ x402: {} }, { mpp: { method: 'evm' } }],
        },
      },
    },
    '/v1/watches': {
      post: {
        tags: ['monitoring'],
        summary: 'Create a scheduled watch (free; pre-paid runs via the x402 top-up)',
        description:
          'Register an https URL + interval; webcap re-runs the capture or extract pipeline on schedule, ' +
          'detects changes, and fires the webhook when one is set. The watch starts with 0 credits: its first ' +
          'due run is recorded as no-credit and pauses it until a top-up. The first run after creation is due ' +
          'immediately (next scheduler tick).',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: watchCreateBody } },
        },
        responses: {
          201: { description: 'Created; {id, state} with the full watch state (no runs yet)', content: jsonContent({
            type: 'object',
            properties: {
              id: { type: 'string' },
              state: watchStateResponse,
            },
          }) },
          400: jsonError('400', 'Invalid watch spec: url, every, mode, schema or webhook (error envelope, code bad_request)'),
        },
        security: [],
      },
    },
    '/v1/watches/{id}': {
      get: {
        tags: ['monitoring'],
        summary: 'Watch state + the last ~10 runs (newest first)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'The watch state incl. credits, paused, next/last run and recent runs', content: jsonContent(watchStateResponse) },
          404: jsonError('404', 'Unknown watch id (error envelope, code not_found)'),
        },
        security: [],
      },
      delete: {
        tags: ['monitoring'],
        summary: 'Delete a watch and all of its runs',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          204: { description: 'Deleted; empty body' },
          404: jsonError('404', 'Unknown watch id (error envelope, code not_found)'),
        },
        security: [],
      },
    },
    '/v1/x402/watches/topup': {
      post: {
        tags: ['monitoring'],
        summary: `Top up a watch with a ${WATCH_TOPUP_RUNS}-run pack (paid, x402)`,
        description:
          `Buy a ${WATCH_TOPUP_RUNS}-run pack for a watch, priced at the watch's mode unit price × ${WATCH_TOPUP_RUNS}: ` +
          `capture ${config.x402PriceUsdcUnits / USDC_SCALE} USDC × ${WATCH_TOPUP_RUNS} = ` +
          `${watchTopUpPriceUsdcUnits('capture', config) / USDC_SCALE} USDC; extract ` +
          `${config.x402ExtractPriceUsdcUnits / USDC_SCALE} USDC × ${WATCH_TOPUP_RUNS} = ` +
          `${watchTopUpPriceUsdcUnits('extract', config) / USDC_SCALE} USDC. ` +
          `On success credits += ${WATCH_TOPUP_RUNS}, a paused watch resumes and its next_run_at is rescheduled. ` +
          'Include the watch as ?watchId= in the URL as well as in the body so the 402 challenge can ' +
          'price the pack at the watch mode before payment.',
        parameters: [
          {
            name: 'watchId',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'The watch to top up; when present, the 402 challenge amount is that watch mode unit price × 100 (falls back to the capture-mode pack price when unknown)',
          },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: watchTopUpBody } },
        },
        responses: {
          200: { description: 'Paid + settled; the new credit balance and the pack price', content: jsonContent(watchTopUpResponse) },
          402: x402Challenge(config, {
            priceUsdcUnits: watchTopUpPriceUsdcUnits('capture', config),
            resourcePath: '/v1/x402/watches/topup',
            amountNote:
              `The amount is the watch mode unit price × ${WATCH_TOPUP_RUNS} (capture ` +
              `${watchTopUpPriceUsdcUnits('capture', config) / USDC_SCALE} USDC, extract ` +
              `${watchTopUpPriceUsdcUnits('extract', config) / USDC_SCALE} USDC).`,
          }),
          400: jsonError('400', 'Malformed JSON body, or missing/invalid watchId or runs (error envelope, code bad_request)'),
          404: jsonError('404', 'Unknown watchId (error envelope, code not_found)'),
          503: jsonError('503', 'x402 disabled on this deployment (WEBCAP_CHAIN=local)'),
        },
        'x-payment-info': {
          price: {
            mode: 'dynamic',
            currency: 'USD',
            min: usdAmount(watchTopUpPriceUsdcUnits('capture', config)),
            max: usdAmount(watchTopUpPriceUsdcUnits('extract', config)),
          },
          protocols: [{ x402: {} }, { mpp: { method: 'evm' } }],
        },
      },
    },
  };
}
