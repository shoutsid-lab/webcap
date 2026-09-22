/**
 * Shared builders for the OpenAPI catalog: the JSON error response helper,
 * the x402 v2 payment-required challenge schema (mirrors buildUnpaidBody in
 * src/server/x402.ts byte-for-byte), and the 402 response shared by ALL paid
 * x402 routes. Split out of openapi.ts as a pure move (no behavior change).
 */
import { USDC_SCALE, type WebcapConfig } from '../../config.js';
import type { Json, OpenapiOperation, OpenapiParameter, OpenapiPaths, OpenapiResponse } from './types.js';

export const jsonContent = (schema: Json) => ({ 'application/json': { schema } });

const errorSchema = { $ref: '#/components/schemas/Error' };

export const jsonError = (status: string, description: string): OpenapiResponse => ({
  description,
  content: jsonContent(errorSchema),
});

/** Responses shared across the per-path docs (built once in openapiDocument). */
export interface PathContext {
  readonly badInput: OpenapiResponse;
  readonly unprocessable: (message: string) => OpenapiResponse;
  readonly captureFailed: OpenapiResponse;
  readonly unauthorized: OpenapiResponse;
  /** Effective preview markdown limit (config.previewMarkdownLimit ?? default). */
  readonly previewMarkdownLimit: number;
}

/**
 * The x402 v2 payment-required challenge — mirrors buildUnpaidBody in
 * src/server/x402.ts (accepts[] + extensions.bazaar).
 */
function paymentRequiredSchema(config: WebcapConfig, priceUsdcUnits: number, resourcePath: string): Json {
  return {
    type: 'object',
    description:
      'The x402 v2 payment challenge. Delivered TWICE per 402 response: base64-encoded in the PAYMENT-REQUIRED response header, and as this JSON body (curl/agent-friendly). Sign accepts[0] as a gasless EIP-3009 transferWithAuthorization and retry with the PAYMENT-SIGNATURE header.',
    properties: {
      x402Version: { type: 'integer', example: 2 },
      error: { type: 'string', example: 'Payment required' },
      resource: {
        type: 'object',
        properties: {
          url: { type: 'string', example: `${config.publicBaseUrl}${resourcePath}` },
          description: { type: 'string' },
          mimeType: { type: 'string', example: 'application/json' },
          serviceName: { type: 'string', example: 'Webcap' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            example: ['screenshot', 'web-capture', 'pdf', 'markdown', 'text-extraction'],
          },
          iconUrl: { type: 'string', example: `${config.publicBaseUrl}/icon.png` },
        },
      },
      accepts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            scheme: { type: 'string', enum: ['exact'], description: 'x402 v2 scheme' },
            network: { type: 'string', example: config.x402Network ?? 'eip155:84532', description: 'CAIP-2 network id' },
            asset: { type: 'string', example: config.x402Asset, description: 'ERC-20 USDC contract address' },
            amount: {
              type: 'string',
              example: String(priceUsdcUnits),
              description: 'Price in atomic 6-decimal USDC units',
            },
            payTo: { type: 'string', example: config.x402PayTo, description: 'Merchant wallet receiving the USDC' },
            maxTimeoutSeconds: { type: 'integer', example: 300 },
            extra: {
              type: 'object',
              description: 'EIP-712 domain of the chain USDC deploy (needed to sign)',
              example: { name: 'USDC', version: '2' },
            },
          },
        },
      },
      extensions: {
        type: 'object',
        properties: {
          bazaar: {
            type: 'object',
            description:
              'CDP Bazaar discovery extension: service metadata, example input/output, and the full request schema (info, input, inputSchema, output, schema).',
            properties: {
              info: { type: 'object', description: 'Resource info incl. pinned input method (POST)' },
              input: { type: 'object', description: 'Example request body' },
              inputSchema: { type: 'object', description: 'JSON Schema of the request body' },
              output: { type: 'object', description: 'Example response' },
              schema: { type: 'object', description: 'Full request schema (method, input, output)' },
            },
          },
        },
      },
    },
  };
}

/** What a 402 challenge prices, and the route it prices. */
interface X402ChallengeSpec {
  readonly priceUsdcUnits: number;
  readonly resourcePath: string;
  /** Prose override for the amount (dynamic prices, e.g. the watch top-up's per-mode pack). */
  readonly amountNote?: string;
}

/** The 402 response shared by ALL paid x402 routes (header + JSON body mirror, one builder). */
function x402Challenge(config: WebcapConfig, spec: X402ChallengeSpec): OpenapiResponse {
  const amountNote = spec.amountNote ?? `The amount is ${spec.priceUsdcUnits / USDC_SCALE} USDC.`;
  return {
    description:
      'Payment required (x402 v2). The challenge is sent as the base64-encoded JSON PAYMENT-REQUIRED ' +
      'response header AND as the equivalent JSON body shown below (curl/agent-friendly). ' +
      `${amountNote} Sign accepts[0] (scheme "exact", gasless EIP-3009 transferWithAuthorization, USDC) and retry ` +
      'with the PAYMENT-SIGNATURE header; the facilitator verifies + settles on-chain. ' +
      'MPP clients charge the same accepts[0] terms through the mpp flow advertised in x-payment-info.',
    headers: {
      'PAYMENT-REQUIRED': {
        description: 'Base64-encoded JSON with the exact shape of the JSON body below (decode: base64 -d)',
        schema: { type: 'string' },
      },
      'WWW-Authenticate': {
        description: 'MPP Payment challenge (id, realm, method, intent, request) for the same price terms — see x-payment-info',
        schema: { type: 'string' },
      },
    },
    content: jsonContent(paymentRequiredSchema(config, spec.priceUsdcUnits, spec.resourcePath)),
  };
}

/**
 * Every paid path is served for GET as well as POST: the x402 challenge is
 * advertised per method, and a paying client retries the method it was
 * challenged on, so a GET must be payable into a working response
 * (src/server/query-body.ts turns the query string into the POST body). The
 * catalog has to describe what the server serves, so each paid POST gets a GET
 * sibling here — derived from the POST operation, so price, status codes and
 * payment terms can never disagree between the two forms.
 */
export function withPaidGetForms(
  paths: OpenapiPaths,
  pathNames: readonly string[],
): OpenapiPaths {
  const out: Record<string, Record<string, OpenapiOperation>> = {};
  for (const [path, methods] of Object.entries(paths)) {
    out[path] = { ...methods };
  }
  for (const name of pathNames) {
    const entry = out[name];
    const post = entry?.['post'];
    if (entry === undefined || post === undefined) {
      throw new Error(`withPaidGetForms: no POST operation documented for ${name}`);
    }
    entry['get'] = paidGetForm(post);
  }
  return out;
}

/** The GET sibling of a paid POST: same responses and terms, body -> query. */
function paidGetForm(post: OpenapiOperation): OpenapiOperation {
  const bodySchema = post.requestBody?.content['application/json']?.schema;
  const properties =
    typeof bodySchema === 'object' && bodySchema !== null && 'properties' in bodySchema
      ? (bodySchema as { properties?: Record<string, Json> }).properties
      : undefined;
  const required =
    typeof bodySchema === 'object' && bodySchema !== null && 'required' in bodySchema
      ? (bodySchema as { required?: readonly string[] }).required
      : undefined;
  const parameters: OpenapiParameter[] = Object.entries(properties ?? {}).map(([name, schema]) => ({
    name,
    in: 'query' as const,
    ...(required?.includes(name) === true ? { required: true } : {}),
    description: `Same value as the POST body field \`${name}\`; encode arrays and objects as JSON.`,
    schema,
  }));
  return {
    ...(post.tags !== undefined ? { tags: post.tags } : {}),
    summary: `(GET form) ${post.summary ?? ''}`.trim(),
    description:
      'GET form of this paid route: identical work, price and responses, with the POST body fields passed as ' +
      'query parameters instead. Numbers and booleans are typed on the wire (?maxUrls=5, ?fullPage=true) and arrays ' +
      'or objects are JSON-encoded (?urls=["https://…"], ?options={"maxContentWords":800}). The 402 challenge is ' +
      'advertised per method, so sign the challenge you received for this method and retry with it.',
    ...(parameters.length > 0 ? { parameters } : {}),
    responses: post.responses,
    ...(post['x-payment-info'] !== undefined ? { 'x-payment-info': post['x-payment-info'] } : {}),
    ...(post.security !== undefined ? { security: post.security } : {}),
  };
}

export { x402Challenge };
