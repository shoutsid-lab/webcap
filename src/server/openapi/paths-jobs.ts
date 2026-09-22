import { CAPTURE_COST_CREDITS, USDC_SCALE } from '../../config.js';
import { captureRequestBody } from './schemas.js';
import { jsonContent, jsonError, type PathContext } from './shared.js';
import type { OpenapiPaths } from './types.js';
import type { WebcapConfig } from '../../config.js';

/** 6-decimal USDC amount as the fixed-point string mppscan's x-payment-info expects (1000 -> '0.001000'). */
const usdAmount = (units: number): string => (units / USDC_SCALE).toFixed(6);

export function jobsPaths(config: WebcapConfig, ctx: PathContext): OpenapiPaths {
  return {
    '/v1/capture/jobs': {
      post: {
        tags: ['capture'],
        summary: 'Enqueue an async capture job (paid once at submit)',
        description:
          'Enqueue a screenshot capture as a background job: the submit charges once ' +
          `(1 credit on the API-key rail, ${config.x402PriceUsdcUnits / 1_000_000} USDC over x402) and returns 202 ` +
          '{jobId, status}. Poll GET /v1/capture/jobs/{id} (free, no auth) until status is completed|failed. ' +
          'An optional https webhookUrl receives the terminal delivery (signed with x-hub-signature-256 when a job secret is configured).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['url'],
                properties: {
                  ...(captureRequestBody.properties as Record<string, unknown>),
                  webhookUrl: { type: 'string', description: 'Optional https URL receiving the terminal delivery ({jobId, status, artifactUrl|error}); signed with x-hub-signature-256 when a job secret is configured' },
                },
              },
            },
          },
        },
        responses: {
          202: {
            description: 'Enqueued; poll GET /v1/capture/jobs/{id} for the terminal state',
            content: jsonContent({
              type: 'object',
              properties: {
                jobId: { type: 'string', format: 'uuid' },
                status: { type: 'string', enum: ['queued'] },
              },
            }),
          },
          401: ctx.unauthorized,
          402: {
            description:
              'Payment required: insufficient credits on the API-key rail (error envelope, code insufficient_credits; ' +
              'detail {invoiceId, requiredUsdc, balance} names the 1-credit top-up invoice), ' +
              'or the x402 challenge on x402 deployments',
            content: jsonContent({ $ref: '#/components/schemas/Error' }),
          },
          422: ctx.unprocessable('Invalid input: missing/invalid url, format, or webhookUrl'),
          429: jsonError('429', 'Spend cap exceeded (error envelope, code spend_cap_exceeded; detail {payer, spent, cap, reason}; per-payer USDC units on x402, per-account credits on the API-key rail; unset cap means unlimited)'),
        },
        // The async submit is paid (1 credit on the API-key rail, or the capture
        // price over x402/mpp). Without this declaration mppscan/Bazaar read the
        // op as unprotected and skip it, hiding a paid route from agents.
        'x-payment-info': {
          price: { mode: 'fixed', currency: 'USD', amount: usdAmount(config.x402PriceUsdcUnits) },
          protocols: [{ x402: {} }, { mpp: { method: 'evm' } }],
        },
      },
    },
    '/v1/capture/jobs/{id}': {
      get: {
        tags: ['capture'],
        summary: 'Poll an async capture job (free, no auth)',
        description:
          'Free status poll: queued|processing while the capture runs, completed with result.artifactUrl, ' +
          'or failed with error. Terminal states carry the payment receipt (payer, priceUsdcUnits, plus creditsUsed/costUsdcUnits where applicable). ' +
          'The artifact URL accepts optional signed query ?exp=&sig= (HMAC-SHA256 over "<id>.<exp>"): bad signatures 403 (code forbidden), expired ones 410 (code gone); unsigned fetches keep serving with a Deprecation header.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: {
            description: 'The job state, incl. the payment receipt and (when completed) the artifact URL',
            content: jsonContent({
              type: 'object',
              properties: {
                jobId: { type: 'string', format: 'uuid' },
                status: { type: 'string', enum: ['queued', 'processing', 'completed', 'failed'] },
                payment: {
                  type: 'object',
                  properties: {
                    payer: { type: 'string' },
                    priceUsdcUnits: { type: 'integer', example: config.x402PriceUsdcUnits },
                    creditsUsed: { type: 'integer', example: CAPTURE_COST_CREDITS },
                    costUsdcUnits: { type: 'integer' },
                  },
                },
                result: {
                  type: 'object',
                  description: 'Present when status=completed',
                  properties: {
                    artifactUrl: { type: 'string', description: 'Canonical public artifact URL' },
                  },
                },
                error: { type: 'string', description: 'Present when status=failed' },
              },
            }),
          },
          404: jsonError('404', 'Unknown job id (error envelope, code not_found)'),
        },
        security: [],
      },
    },
  };
}
