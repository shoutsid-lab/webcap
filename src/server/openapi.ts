/**
 * The webcap OpenAPI 3.1 catalog served at GET /openapi.json.
 *
 * The document is config-driven (servers come from the deployment's public
 * base URL; 402 amounts mirror the live prices), and its 402 response shape
 * mirrors src/server/x402.ts byte-for-byte: the PAYMENT-REQUIRED response
 * header (base64-encoded JSON) plus the equivalent JSON body with accepts[]
 * + extensions.bazaar.
 */
import type { WebcapConfig } from '../config.js';
import { USDC_SCALE } from '../config.js';

/** JSON value (OpenAPI schema payloads are plain JSON). */
export type Json = string | number | boolean | null | Json[] | { readonly [key: string]: Json };

export interface OpenapiResponse {
  readonly description: string;
  /** Named response headers (e.g. PAYMENT-REQUIRED on 402). */
  readonly headers?: { readonly [name: string]: { readonly description: string; readonly schema: Json } };
  /** Media type -> schema. */
  readonly content?: { readonly [mediaType: string]: { readonly schema: Json } };
}

export interface OpenapiParameter {
  readonly name: string;
  readonly in: 'path' | 'query' | 'header';
  readonly required?: boolean;
  readonly schema: Json;
  readonly description?: string;
}

export interface OpenapiOperation {
  readonly tags?: readonly string[];
  readonly summary?: string;
  readonly description?: string;
  readonly parameters?: readonly OpenapiParameter[];
  readonly requestBody?: {
    readonly required?: boolean;
    readonly description?: string;
    readonly content: { readonly [mediaType: string]: { readonly schema: Json } };
  };
  readonly responses: { readonly [status: string]: OpenapiResponse };
}

export interface OpenapiDocument {
  readonly openapi: '3.1.0';
  readonly info: { readonly title: string; readonly version: string; readonly description: string };
  readonly servers: readonly { readonly url: string; readonly description?: string }[];
  readonly tags: readonly { readonly name: string; readonly description: string }[];
  readonly paths: { readonly [path: string]: { readonly [method: string]: OpenapiOperation } };
  readonly components: { readonly schemas: { readonly [name: string]: Json } };
}

const jsonContent = (schema: Json) => ({ 'application/json': { schema } });

const errorSchema = { $ref: '#/components/schemas/Error' };

const jsonError = (status: string, description: string): OpenapiResponse => ({
  description,
  content: jsonContent(errorSchema),
});

/**
 * The x402 v2 payment-required challenge — mirrors buildUnpaidBody in
 * src/server/x402.ts (accepts[] + extensions.bazaar).
 */
function paymentRequiredSchema(config: WebcapConfig): Json {
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
          url: { type: 'string', example: `${config.publicBaseUrl}/v1/x402/capture` },
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
              example: String(config.x402PriceUsdcUnits),
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

const captureResponse = (priceUsdcUnits: number): Json => ({
  type: 'object',
  properties: {
    artifact: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['png', 'jpeg', 'pdf'] },
        bytes: { type: 'integer', example: 204_800 },
        data: { type: 'string', description: 'Base64-encoded image bytes' },
        url: { type: 'string', example: '{publicBaseUrl}/v1/artifacts/{id}', description: 'Canonical public artifact URL' },
      },
    },
    payment: {
      type: 'object',
      properties: {
        payer: { type: 'string', example: '0x000000000000000000000000000000000000dEaD' },
        priceUsdcUnits: { type: 'integer', example: priceUsdcUnits },
      },
    },
  },
});

const extractResponse = (priceUsdcUnits: number): Json => ({
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          status: { type: 'string', enum: ['ok', 'error'] },
          data: {
            type: 'object',
            description: 'Present when status=ok; the structured content (plus optional model-extracted "extracted")',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              headings: { type: 'array', items: { type: 'object', properties: { level: { type: 'integer' }, text: { type: 'string' } } } },
              paragraphs: { type: 'array', items: { type: 'string' } },
              links: { type: 'array', items: { type: 'object', properties: { href: { type: 'string' }, text: { type: 'string' } } } },
              images: { type: 'array', items: { type: 'object', properties: { src: { type: 'string' }, alt: { type: 'string' } } } },
              wordCount: { type: 'integer' },
              markdown: { type: 'string' },
              extracted: { type: 'object', description: 'Model-extracted JSON when a schema was supplied' },
            },
          },
          error: { type: 'string', description: 'Present when status=error' },
        },
      },
    },
    payment: {
      type: 'object',
      properties: {
        payer: { type: 'string', example: '0x000000000000000000000000000000000000dEaD' },
        priceUsdcUnits: { type: 'integer', example: priceUsdcUnits },
      },
    },
  },
});

const captureRequestBody = {
  type: 'object',
  required: ['url'],
  properties: {
    url: { type: 'string', description: 'The page to capture', example: 'https://example.com/' },
    format: { type: 'string', enum: ['png', 'jpeg', 'pdf'], description: 'Screenshot format (default png)' },
    options: {
      type: 'object',
      additionalProperties: false,
      properties: {
        timeoutMs: { type: 'integer', description: 'Page load timeout in milliseconds' },
        fullPage: { type: 'boolean', description: 'Capture the full scrollable page' },
      },
    },
  },
};

const extractRequestBody = {
  type: 'object',
  properties: {
    url: { type: 'string', description: 'A single page to extract', example: 'https://example.com/' },
    urls: {
      type: 'array',
      description: 'Batch of pages for one payment (at most 10)',
      items: { type: 'string' },
      maxItems: 10,
    },
    schema: { type: 'string', description: 'Optional natural-language description of the JSON to extract via a model' },
  },
};

const watchCreateBody = {
  type: 'object',
  required: ['url', 'every', 'mode'],
  properties: {
    url: { type: 'string', description: 'The https URL to watch', example: 'https://example.com/' },
    every: { type: 'string', enum: ['15m', '1h', '6h', '24h'], description: 'Run interval' },
    mode: { type: 'string', enum: ['capture', 'extract'], description: 'Re-run the capture (screenshot) or the extract (structured content) pipeline' },
    schema: { type: 'string', description: 'Optional natural-language extraction schema (extract mode)' },
    webhook: { type: 'string', description: 'Optional https URL that receives a change alert when a run detects a change' },
  },
};

const watchRunView = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    status: { type: 'string', enum: ['ok', 'error', 'no-credit'] },
    changed: { type: 'boolean' },
    artifactUrl: { type: 'string', description: 'Present for ok capture runs' },
    extract: { type: 'object', description: 'Present for ok extract runs; the extract JSON of that run' },
    diffSummary: { type: 'string', description: 'Present when changed; compact list of changed paths (capture: "artifact")' },
    webhook: { type: 'string', description: 'Present when a change alert fired; delivery outcome (e.g. "ok: HTTP 200")' },
    error: { type: 'string', description: 'Present when status=error' },
    createdAt: { type: 'string' },
  },
};

const watchStateResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    url: { type: 'string' },
    every: { type: 'string' },
    mode: { type: 'string' },
    schema: { type: 'string', description: 'Present when set' },
    webhook: { type: 'string', description: 'Present when set' },
    credits: { type: 'integer', description: 'Pre-paid runs remaining (each run consumes 1)' },
    paused: { type: 'boolean', description: 'True when the watch ran out of credits and waits for a top-up' },
    nextRunAt: { type: ['string', 'null'] },
    lastRunAt: { type: ['string', 'null'] },
    runs: { type: 'array', description: 'The last ~10 runs, newest first', items: watchRunView },
  },
};

const watchTopUpBody = {
  type: 'object',
  required: ['watchId', 'runs'],
  properties: {
    watchId: { type: 'string', description: 'The watch to top up' },
    runs: { type: 'integer', enum: [100], description: 'Pack size in runs (always 100)' },
  },
};

const watchTopUpResponse = {
  type: 'object',
  properties: {
    watchId: { type: 'string' },
    credits: { type: 'integer', description: 'The watch credit balance after the top-up' },
    priceUsdcUnits: { type: 'integer', description: 'The pack price paid: the watch mode unit price × 100' },
  },
};

/** The 402 response shared by both paid routes (header + JSON body mirror). */
function x402Response(config: WebcapConfig, priceUsdcUnits: number): OpenapiResponse {
  return {
    description:
      `Payment required (x402 v2). The challenge is sent as the base64-encoded JSON PAYMENT-REQUIRED ` +
      `response header AND as the equivalent JSON body shown below (curl/agent-friendly). ` +
      `Sign accepts[0] (scheme "exact", gasless EIP-3009 transferWithAuthorization, USDC, amount ${
        priceUsdcUnits / USDC_SCALE
      }) and retry with the PAYMENT-SIGNATURE header; the facilitator verifies + settles on-chain.`,
    headers: {
      'PAYMENT-REQUIRED': {
        description: 'Base64-encoded JSON with the exact shape of the JSON body below (decode: base64 -d)',
        schema: { type: 'string' },
      },
    },
    content: jsonContent(paymentRequiredSchema(config)),
  };
}

/** Build the full OpenAPI 3.1 document for a deployment. */
export function openapiDocument(config: WebcapConfig): OpenapiDocument {
  const badInput = jsonError('400', 'Malformed JSON request body or bad input (error envelope)');
  return {
    openapi: '3.1.0',
    info: {
      title: 'webcap',
      version: '0.1.0',
      description:
        'Pay-per-call web capture: any URL becomes a PNG/JPEG/PDF screenshot + free Open Graph metadata, ' +
        'or structured text/JSON via batch extract. Paid per call in USDC over x402 (HTTP 402, x402 v2 ' +
        '"exact" scheme, gasless EIP-3009 — the facilitator settles, no ETH or gas for the payer). ' +
        'No API keys, no accounts for x402 routes.',
    },
    servers: [
      { url: config.publicBaseUrl, description: 'public deployment' },
      { url: 'http://localhost:8080', description: 'local development' },
    ],
    tags: [
      { name: 'capture', description: 'URL → PNG/JPEG/PDF screenshot (+ free OG metadata)' },
      { name: 'extract', description: 'URL(s) → structured text/JSON' },
      { name: 'monitoring', description: 'Scheduled watches: create, state, delete, x402 credit top-up' },
      { name: 'artifacts', description: 'Stored capture artifacts' },
      { name: 'discovery', description: 'Service metadata, catalog, icon' },
    ],
    paths: {
      '/v1/x402/capture': {
        post: {
          tags: ['capture'],
          summary: 'Capture a URL as a screenshot (paid, x402)',
          description:
            'Capture the URL as a PNG/JPEG/PDF screenshot plus free OG metadata. Unpaid requests receive the ' +
            'x402 402 challenge; paying clients retry with PAYMENT-SIGNATURE. One payment per URL.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: captureRequestBody } },
          },
          responses: {
            200: { description: 'Paid + settled; the artifact (base64) and its canonical public URL', content: jsonContent(captureResponse(config.x402PriceUsdcUnits)) },
            402: x402Response(config, config.x402PriceUsdcUnits),
            400: badInput,
            503: jsonError('503', 'x402 disabled on this deployment (WEBCAP_CHAIN=local)'),
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
            402: x402Response(config, config.x402ExtractPriceUsdcUnits),
            400: badInput,
            502: jsonError('502', 'All URLs in the batch failed to extract'),
            503: jsonError('503', 'x402 disabled on this deployment (WEBCAP_CHAIN=local)'),
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
            400: badInput,
          },
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
        },
      },
      '/v1/x402/watches/topup': {
        post: {
          tags: ['monitoring'],
          summary: 'Top up a watch with a 100-run pack (paid, x402)',
          description:
            `Buy a 100-run pack for a watch, priced at the watch's mode unit price × 100: ` +
            `capture ${config.x402PriceUsdcUnits / USDC_SCALE} USDC x 100 = ` +
            `${config.x402PriceUsdcUnits * 100 / USDC_SCALE} USDC; extract ` +
            `${config.x402ExtractPriceUsdcUnits / USDC_SCALE} USDC x 100 = ` +
            `${config.x402ExtractPriceUsdcUnits * 100 / USDC_SCALE} USDC. ` +
            'On success credits += 100, a paused watch resumes and its next_run_at is rescheduled. ' +
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
            402: {
              description:
                `Payment required (x402 v2). The challenge is sent as the base64-encoded JSON PAYMENT-REQUIRED ` +
                `response header AND as the equivalent JSON body shown below (curl/agent-friendly). ` +
                `The amount is the watch mode unit price × 100 (capture ` +
                `${config.x402PriceUsdcUnits * 100 / USDC_SCALE} USDC, extract ` +
                `${config.x402ExtractPriceUsdcUnits * 100 / USDC_SCALE} USDC). ` +
                'Sign accepts[0] (scheme "exact", gasless EIP-3009 transferWithAuthorization, USDC) and retry ' +
                'with the PAYMENT-SIGNATURE header; the facilitator verifies + settles on-chain.',
              headers: {
                'PAYMENT-REQUIRED': {
                  description: 'Base64-encoded JSON with the exact shape of the JSON body below (decode: base64 -d)',
                  schema: { type: 'string' },
                },
              },
              content: jsonContent(paymentRequiredSchema(config)),
            },
            400: badInput,
            404: jsonError('404', 'Unknown watchId (error envelope, code not_found)'),
            503: jsonError('503', 'x402 disabled on this deployment (WEBCAP_CHAIN=local)'),
          },
        },
      },
      '/v1/extract/preview': {
        get: {
          tags: ['extract'],
          summary: 'Free bounded structured preview (no payment, rate-limited)',
          description: 'Sample the extract output without paying: a truncated preview (headings, links, first 1500 chars of markdown). Rate-limited per client.',
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
                      markdown: { type: 'string', description: 'First 1500 characters of the document-order markdown' },
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
                },
              }),
            },
            400: badInput,
            422: jsonError('422', 'Missing or invalid url query parameter (error envelope)'),
            429: jsonError('429', 'Preview rate limit exceeded; use the paid extract endpoint'),
          },
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
        },
      },
      '/icon.png': {
        get: {
          tags: ['discovery'],
          summary: 'Service icon (PNG)',
          responses: {
            200: { description: 'The webcap icon', content: { 'image/png': { schema: { type: 'string', format: 'binary' } } } },
          },
        },
      },
      '/openapi.json': {
        get: {
          tags: ['discovery'],
          summary: 'This OpenAPI catalog',
          responses: {
            200: { description: 'The OpenAPI 3.1 document', content: jsonContent({ $ref: '#/components/schemas/OpenapiDocument' }) },
          },
        },
      },
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
    },
    components: {
      schemas: {
        Error: {
          type: 'object',
          description: 'The webcap error envelope returned for every non-2xx response',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'bad_request' },
                message: { type: 'string', example: 'url is required' },
                detail: { type: 'object', additionalProperties: true, description: 'Optional structured detail' },
              },
            },
          },
        },
        OpenapiDocument: {
          type: 'object',
          description: 'An OpenAPI 3.1 document (this catalog)',
          properties: {
            openapi: { type: 'string', example: '3.1.0' },
            info: { type: 'object' },
            servers: { type: 'array' },
            paths: { type: 'object' },
          },
        },
      },
    },
  };
}
