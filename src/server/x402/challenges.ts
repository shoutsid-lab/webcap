/**
 * The x402 402-challenge builders for webcap's paid routes: the bazaar
 * discovery-extension specs (input schemas + output examples, pinned to the
 * POST verb by withRoutedMethod) and buildUnpaidBody, the static mirror of
 * the PAYMENT-REQUIRED header that every 402 response body carries. Split out
 * of x402.ts as a pure move (no behavior change); x402.ts re-exports
 * everything it used to.
 */
import {
  declareDiscoveryExtension,
  type BodyDiscoveryExtension,
  type DiscoveryExtension,
} from '@x402/extensions/bazaar';
import type { PaymentRequired, PaymentRequirements } from '@x402/core/types';
import { PACKS, WATCH_TOPUP_RUNS, watchTopUpPriceUsdcUnits, type WebcapConfig } from '../../config.js';
import { MAX_EXTRACT_BATCH } from '../extract-parse.js';

const X402_VERSION = 2;
export const X402_CAPTURE_DESCRIPTION = 'Capture a URL as PNG/JPEG/PDF + free OG metadata';
export const X402_EXTRACT_DESCRIPTION = 'Capture a URL and return its structured content (title, headings, text, links, images) as JSON';
export const X402_TOPUP_DESCRIPTION =
  'Top up a webcap watch with a 100-run pack, priced at the watch mode unit price x 100 (capture or extract)';
export const X402_MIME_TYPE = 'application/json';

export const BAZAAR_SERVICE_NAME = 'Webcap';
export const BAZAAR_TAGS = ['screenshot', 'web-capture', 'pdf', 'markdown', 'text-extraction'];
const BAZAAR_HTTP_METHOD = 'POST';
// Placeholder payer for the output examples (never a real merchant address);
// also imported by the OpenAPI catalog so every doc example uses one literal.
export const BAZAAR_EXAMPLE_PAYER = '0x000000000000000000000000000000000000dEaD';

/** Bazaar input schema for POST /v1/x402/capture — mirrors url + parseFormat/parseOptions. */
const CAPTURE_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    url: { type: 'string', description: 'The page to capture' },
    format: { type: 'string', enum: ['png', 'jpeg', 'pdf'], description: 'Screenshot format (default png)' },
    options: {
      type: 'object',
      description: 'Capture options',
      properties: {
        timeoutMs: { type: 'integer', description: 'Page load timeout in milliseconds' },
        fullPage: { type: 'boolean', description: 'Capture the full scrollable page' },
      },
      additionalProperties: false,
    },
  },
  required: ['url'],
};

const CAPTURE_OUTPUT_EXAMPLE: Record<string, unknown> = {
  artifact: {
    format: 'png',
    bytes: 2048,
    data: 'aGVsbG8gd29ybGQ=',
    url: 'https://example.com/v1/artifacts/00000000-0000-4000-8000-000000000000',
  },
  payment: { payer: BAZAAR_EXAMPLE_PAYER, priceUsdcUnits: 1_000 },
};

/** Bazaar input schema for POST /v1/x402/extract — mirrors parseExtractUrls/parseExtractSchema. */
const EXTRACT_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    url: { type: 'string', description: 'A single page to extract' },
    urls: {
      type: 'array',
      description: 'Batch of pages for one payment (at most 10)',
      items: { type: 'string' },
      maxItems: MAX_EXTRACT_BATCH,
    },
    schema: { type: 'string', description: 'Optional natural-language description of the JSON to extract via a model' },
  },
};

const EXTRACT_OUTPUT_EXAMPLE: Record<string, unknown> = {
  results: [
    {
      url: 'https://example.com',
      status: 'ok',
      data: {
        title: 'Example Domain',
        description: 'For use in examples.',
        headings: [{ level: 1, text: 'Example Domain' }],
        paragraphs: ['This domain is for use in illustrative examples.'],
        links: [{ href: 'https://www.iana.org/domains/example', text: 'More information...' }],
        images: [],
        wordCount: 9,
        markdown: '# Example Domain\n\nThis domain is for use in illustrative examples.',
      },
    },
  ],
  payment: { payer: BAZAAR_EXAMPLE_PAYER, priceUsdcUnits: 10_000 },
};

/** declareDiscoveryExtension wraps the extension under its key; unwrap + narrow it. */
function bazaarFromDeclared(declared: Record<string, DiscoveryExtension>): BodyDiscoveryExtension {
  const bazaar = declared['bazaar'];
  if (bazaar === undefined) throw new Error('declareDiscoveryExtension did not return a bazaar extension');
  return bazaar as BodyDiscoveryExtension;
}

// The declaration omits info.input.method (the library types it as absent at
// declaration time); withRoutedMethod pins it for the POST route so the static
// 402 body and the middleware-enriched header both carry it.
export function buildCaptureBazaarExtension(): BodyDiscoveryExtension {
  return withRoutedMethod(
    bazaarFromDeclared(
      declareDiscoveryExtension({
        bodyType: 'json',
        input: { url: 'https://example.com', format: 'png' },
        inputSchema: CAPTURE_INPUT_SCHEMA,
        output: { example: CAPTURE_OUTPUT_EXAMPLE },
      }),
    ),
  );
}

export function buildExtractBazaarExtension(): BodyDiscoveryExtension {
  return withRoutedMethod(
    bazaarFromDeclared(
      declareDiscoveryExtension({
        bodyType: 'json',
        input: { url: 'https://example.com' },
        inputSchema: EXTRACT_INPUT_SCHEMA,
        output: { example: EXTRACT_OUTPUT_EXAMPLE },
      }),
    ),
  );
}

/** Bazaar input schema for POST /v1/x402/watches/topup — mirrors the top-up handler. */
const TOPUP_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    watchId: { type: 'string', description: 'The watch to top up' },
    runs: { type: 'integer', enum: [WATCH_TOPUP_RUNS], description: 'Pack size in runs (always 100)' },
  },
  required: ['watchId', 'runs'],
};

/** The top-up 200 example, derived from config: starter-pack credit count + the capture-mode pack price. */
export function topUpOutputExample(config: WebcapConfig): Record<string, unknown> {
  return {
    watchId: '00000000-0000-4000-8000-000000000000',
    credits: PACKS.starter.credits,
    priceUsdcUnits: watchTopUpPriceUsdcUnits('capture', config),
  };
}

export function buildTopUpBazaarExtension(config: WebcapConfig): BodyDiscoveryExtension {
  return withRoutedMethod(
    bazaarFromDeclared(
      declareDiscoveryExtension({
        bodyType: 'json',
        input: { watchId: '00000000-0000-4000-8000-000000000000', runs: WATCH_TOPUP_RUNS },
        inputSchema: TOPUP_INPUT_SCHEMA,
        output: { example: topUpOutputExample(config) },
      }),
    ),
  );
}

/** The service metadata + bazaar extension a route advertises (mirrored into the 402 body). */
export interface UnpaidBazaarMetadata {
  readonly resourceUrl: string;
  readonly serviceName: string;
  readonly tags: readonly string[];
  readonly iconUrl: string;
  readonly bazaar: BodyDiscoveryExtension;
}

/**
 * Static mirror of bazaarResourceServerExtension.enrichDeclaration for a POST route:
 * pins info.input.method and narrows the schema method enum to the route's verb, so
 * the 402 JSON body equals the enriched PAYMENT-REQUIRED header challenge.
 */
function withRoutedMethod(extension: BodyDiscoveryExtension): BodyDiscoveryExtension {
  const inputSchema = extension.schema.properties.input;
  const required: ('type' | 'method' | 'bodyType' | 'body')[] = inputSchema.required.includes('method')
    ? inputSchema.required
    : [...inputSchema.required, 'method'];
  return {
    ...extension,
    info: { ...extension.info, input: { ...extension.info.input, method: BAZAAR_HTTP_METHOD } },
    schema: {
      ...extension.schema,
      properties: {
        ...extension.schema.properties,
        input: {
          ...inputSchema,
          properties: { ...inputSchema.properties, method: { type: 'string', enum: [BAZAAR_HTTP_METHOD] } },
          required,
        },
      },
    },
  };
}

/** 402 body mirror of the PAYMENT-REQUIRED header (curl/agent-friendly). */
export function buildUnpaidBody(
  requirement: PaymentRequirements,
  description: string,
  metadata: UnpaidBazaarMetadata,
): PaymentRequired {
  return {
    x402Version: X402_VERSION,
    error: 'Payment required',
    resource: {
      url: metadata.resourceUrl,
      description,
      mimeType: X402_MIME_TYPE,
      serviceName: metadata.serviceName,
      tags: [...metadata.tags],
      iconUrl: metadata.iconUrl,
    },
    accepts: [requirement],
    extensions: { bazaar: withRoutedMethod(metadata.bazaar) },
  };
}
