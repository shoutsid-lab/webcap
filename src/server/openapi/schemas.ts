/**
 * The per-route schema components of the OpenAPI catalog: request bodies and
 * response shapes for capture, extract, watches, and the watch top-up. Split
 * out of openapi.ts as a pure move (no behavior change).
 */
import { CAPTURE_COST_CREDITS, WATCH_TOPUP_RUNS } from '../../config.js';
import { BAZAAR_EXAMPLE_PAYER } from '../x402.js';
import type { Json } from './types.js';

const artifactSchema: Json = {
  type: 'object',
  properties: {
    format: { type: 'string', enum: ['png', 'jpeg', 'pdf'] },
    bytes: { type: 'integer', example: 204_800 },
    data: { type: 'string', description: 'Base64-encoded image bytes' },
    url: { type: 'string', example: '{publicBaseUrl}/v1/artifacts/{id}', description: 'Canonical public artifact URL' },
  },
};

const captureResponse = (priceUsdcUnits: number): Json => ({
  type: 'object',
  properties: {
    artifact: artifactSchema,
    payment: {
      type: 'object',
      properties: {
        payer: { type: 'string', example: BAZAAR_EXAMPLE_PAYER },
        priceUsdcUnits: { type: 'integer', example: priceUsdcUnits },
      },
    },
  },
});

/** The credit-based POST /v1/capture 200 (same artifact, credit accounting instead of payment). */
const captureCreditResponse: Json = {
  type: 'object',
  properties: {
    artifact: artifactSchema,
    creditsCharged: { type: 'integer', example: CAPTURE_COST_CREDITS },
    balance: { type: 'integer', description: 'Credits remaining after the charge' },
  },
};

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
        payer: { type: 'string', example: BAZAAR_EXAMPLE_PAYER },
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

// oneOf (not top-level required): the runtime accepts either `url` or `urls`;
// a schema-driven caller that sees both optional may synthesize a body with
// neither, which 422s at runtime. The x402gle live audition hit exactly that.
const extractRequestBody = {
  type: 'object',
  oneOf: [{ required: ['url'] }, { required: ['urls'] }],
  properties: {
    url: { type: 'string', format: 'uri', description: 'A single absolute http(s) page to extract', example: 'https://example.com/' },
    urls: {
      type: 'array',
      description: 'Batch of absolute http(s) pages for one payment (at most 10)',
      items: { type: 'string', format: 'uri' },
      maxItems: 10,
    },
    schema: { type: 'string', description: 'Optional plain natural-language string describing the JSON to extract via a model (a string, not a JSON object)' },
  },
};

const auditRequestBody = {
  type: 'object',
  required: ['url'],
  properties: {
    url: { type: 'string', format: 'uri', example: 'https://example.com/' },
  },
};

const auditResponse = (priceUsdcUnits: number): Json => ({
  type: 'object',
  properties: {
    audit: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        seo: {
          type: 'object',
          properties: {
            title: {
              type: 'object',
              properties: {
                present: { type: 'boolean' },
                length: { type: 'integer' },
                ok: { type: 'boolean' },
              },
            },
            description: {
              type: 'object',
              properties: {
                present: { type: 'boolean' },
                length: { type: 'integer' },
                ok: { type: 'boolean' },
              },
            },
            h1Count: { type: 'integer' },
            h1Ok: { type: 'boolean' },
            canonical: {
              type: 'object',
              properties: {
                present: { type: 'boolean' },
                value: { type: 'string' },
              },
            },
            robotsMeta: {
              type: 'object',
              properties: {
                present: { type: 'boolean' },
                value: { type: 'string' },
              },
            },
          },
        },
        og: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            image: { type: 'string' },
            twitterCard: { type: 'string' },
            twitterSite: { type: 'string' },
            twitterCreator: { type: 'string' },
            twitterTitle: { type: 'string' },
            twitterDescription: { type: 'string' },
            twitterImage: { type: 'string' },
            articlePublishedTime: { type: 'string' },
            articleAuthor: { type: 'string' },
            articleSection: { type: 'string' },
            articleTags: { type: 'array', items: { type: 'string' } },
            present: {
              type: 'object',
              properties: {
                title: { type: 'boolean' },
                description: { type: 'boolean' },
                image: { type: 'boolean' },
                twitterCard: { type: 'boolean' },
                twitterSite: { type: 'boolean' },
                twitterCreator: { type: 'boolean' },
                twitterTitle: { type: 'boolean' },
                twitterDescription: { type: 'boolean' },
                twitterImage: { type: 'boolean' },
                articlePublishedTime: { type: 'boolean' },
                articleAuthor: { type: 'boolean' },
                articleSection: { type: 'boolean' },
                articleTags: { type: 'boolean' },
              },
            },
          },
        },
        links: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            internal: { type: 'integer' },
            external: { type: 'integer' },
            emptyText: { type: 'integer' },
            duplicates: { type: 'integer' },
            sample: { type: 'array', items: { type: 'object', properties: { href: { type: 'string' }, text: { type: 'string' } } } },
          },
        },
      },
    },
    payment: {
      type: 'object',
      properties: {
        payer: { type: 'string', example: BAZAAR_EXAMPLE_PAYER },
        priceUsdcUnits: { type: 'integer', example: priceUsdcUnits },
      },
    },
  },
});

const watchCreateBody = {  type: 'object',
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
    runs: { type: 'integer', enum: [WATCH_TOPUP_RUNS], description: `Pack size in runs (always ${WATCH_TOPUP_RUNS})` },
  },
};

const watchTopUpResponse = {
  type: 'object',
  properties: {
    watchId: { type: 'string' },
    credits: { type: 'integer', description: 'The watch credit balance after the top-up' },
    priceUsdcUnits: {
      type: 'integer',
      description: `The pack price paid: the watch mode unit price × ${WATCH_TOPUP_RUNS}`,
    },
  },
};

export {
  auditRequestBody,
  auditResponse,
  captureCreditResponse,
  captureRequestBody,
  captureResponse,
  extractRequestBody,
  extractResponse,
  watchCreateBody,
  watchStateResponse,
  watchTopUpBody,
  watchTopUpResponse,
};
