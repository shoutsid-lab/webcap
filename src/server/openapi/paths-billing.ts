/**
 * The billing/payment webhook path docs: POST /v1/webhooks, GET /v1/webhooks,
 * DELETE /v1/webhooks/:id. Split out for the OpenAPI catalog to document the
 * payment webhook endpoints added in the payment webhooks feature.
 */
import { jsonContent, jsonError, type PathContext } from './shared.js';
import type { OpenapiPaths } from './types.js';

/** The billing/payment webhook path docs. */
export function billingPaths(ctx: PathContext): OpenapiPaths {
  return {
    '/v1/webhooks': {
      post: {
        tags: ['accounts'],
        summary: 'Register a payment webhook (Bearer auth)',
        description:
          'Register an HTTPS webhook URL to receive payment events. The webhook fires on payment.settled events. ' +
          'A signing secret is returned on creation (shown only once). The webhook body is signed with HMAC-SHA256.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['url'],
                properties: {
                  url: { type: 'string', format: 'uri', description: 'HTTPS webhook URL' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Webhook registered; secret shown only on creation',
            content: jsonContent({
              type: 'object',
              properties: {
                id: { type: 'integer' },
                url: { type: 'string', format: 'uri' },
                events: { type: 'array', items: { type: 'string' }, example: ['payment.settled'] },
                secret: { type: 'string', description: 'HMAC signing secret (shown only on creation)' },
              },
            }),
          },
          401: ctx.unauthorized,
          422: ctx.unprocessable('url is required and must be https'),
        },
      },
      get: {
        tags: ['accounts'],
        summary: 'List payment webhooks (Bearer auth)',
        description: 'List all payment webhooks for the authenticated account.',
        responses: {
          200: {
            description: 'List of webhooks',
            content: jsonContent({
              type: 'object',
              properties: {
                webhooks: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'integer' },
                      url: { type: 'string', format: 'uri' },
                      events: { type: 'array', items: { type: 'string' } },
                      active: { type: 'boolean' },
                      createdAt: { type: 'string', format: 'date-time' },
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
    '/v1/webhooks/{id}': {
      delete: {
        tags: ['accounts'],
        summary: 'Deactivate a payment webhook (Bearer auth)',
        description: 'Soft-delete a payment webhook by deactivating it.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'integer' },
            description: 'Webhook ID',
          },
        ],
        responses: {
          200: {
            description: 'Webhook deactivated',
            content: jsonContent({
              type: 'object',
              properties: {
                ok: { type: 'boolean', example: true },
              },
            }),
          },
          401: ctx.unauthorized,
          404: jsonError('404', 'Webhook not found (error envelope, code not_found)'),
        },
      },
    },
  };
}
