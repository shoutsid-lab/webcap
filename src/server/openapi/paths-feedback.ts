/**
 * OpenAPI doc for the feedback surface: POST /v1/feedback (machine + human
 * form), GET /v1/feedback/list (merchant-only view) and GET /feedback (the
 * human page). All three are free-of-payment operations; the machine POST is
 * the agent-first channel, the list is a merchant view behind an apiKey gate,
 * and the page is the thin human counterpart that posts to the same route.
 */
import { jsonContent, jsonError, type PathContext } from './shared.js';
import type { OpenapiPaths } from './types.js';

const CATEGORY_ENUM = ['bug', 'suggestion', 'pricing', 'docs', 'integration', 'other'];

/** POST /v1/feedback + GET /v1/feedback/list + GET /feedback. */
export function feedbackPaths(ctx: PathContext): OpenapiPaths {
  return {
    '/v1/feedback': {
      post: {
        tags: ['discovery'],
        summary: 'Send webcap feedback (machine or human form)',
        description:
          'Free feedback channel, scriptable and form-friendly at once. Machines call it as JSON with no account; the human GET /feedback page posts the same route as application/x-www-form-urlencoded. message (8-4000 chars) is required; category is optional (default other) and endpoint names the webcap route the caller was using. `payer` and `contact` ids are hashed before storage, never stored raw. Rate-limited per client (60/hr). A browser form submit (urlencoded + Accept: text/html) gets the confirmation page; a machine caller gets JSON.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['message'],
                properties: {
                  message: { type: 'string', minLength: 8, maxLength: 4000, description: 'Your feedback text' },
                  category: { type: 'string', enum: CATEGORY_ENUM, description: 'Optional category (default other)' },
                  endpoint: { type: 'string', description: 'Optional webcap route you were using, e.g. POST /v1/x402/capture' },
                  payer: { type: 'string', description: 'Optional 0x address; only its sha256 hash is stored' },
                  contact: { type: 'string', description: 'Optional api-key/contact id; only its sha256 hash is stored' },
                },
              },
            },
            'application/x-www-form-urlencoded': {
              schema: {
                type: 'object',
                required: ['message'],
                properties: {
                  message: { type: 'string', minLength: 8, maxLength: 4000 },
                  category: { type: 'string', enum: CATEGORY_ENUM },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Feedback stored; JSON for machines, the confirmation page for browsers',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { ok: { type: 'boolean', example: true }, id: { type: 'integer' }, category: { type: 'string' } },
                },
              },
              'text/html': { schema: { type: 'string' } },
            },
          },
          422: ctx.unprocessable('message is required / too short / too long'),
          429: jsonError('429', 'Feedback rate limit exceeded (error envelope, code rate_limited)'),
        },
        security: [],
      },
    },
    '/v1/feedback/list': {
      get: {
        tags: ['accounts'],
        summary: 'List stored feedback (merchant-only)',
        description:
          'Newest-first feedback the operator received. Requires the merchant api key (Bearer <key> for the merchant address); anyone else answers 403. Optional ?category= and ?limit= filters.',
        parameters: [
          { name: 'category', in: 'query', required: false, schema: { type: 'string', enum: CATEGORY_ENUM } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 200 } },
        ],
        responses: {
          200: {
            description: 'Stored feedback rows (payer/contact are hashes)',
            content: jsonContent({
              type: 'object',
              properties: {
                feedback: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'integer' },
                      category: { type: 'string' },
                      message: { type: 'string' },
                      endpoint: { type: ['string', 'null'] },
                      payer_hash: { type: 'string', description: 'sha256 hash of the payer, never raw' },
                      contact_hash: { type: 'string' },
                      source: { type: 'string', example: 'http' },
                      created_at: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            }),
          },
          401: ctx.unauthorized,
          403: jsonError('403', 'Feedback list is merchant-only (error envelope, code forbidden)'),
        },
        security: [{ apiKey: [] }],
      },
    },
    '/feedback': {
      get: {
        tags: ['discovery'],
        summary: 'Human feedback page (form posting to POST /v1/feedback)',
        description:
          'A plain, no-JS HTML form: category + message. Submits application/x-www-form-urlencoded to POST /v1/feedback and renders the confirmation or rejection inline. Free, no account.',
        responses: {
          200: { description: 'The feedback page (text/html; charset=utf-8)', content: { 'text/html': { schema: { type: 'string' } } } },
        },
        security: [],
      },
    },
  };
}
