import type { FastifyInstance, FastifyRequest } from 'fastify';
import { paymentMiddleware } from '@x402/fastify';
import {
  declareDiscoveryExtension,
  validateBazaarRouteExtensions,
  type BodyDiscoveryExtension,
  type DiscoveryExtension,
} from '@x402/extensions/bazaar';
import { x402ResourceServer, type FacilitatorClient, type RouteConfig, type RoutesConfig } from '@x402/core/server';
import type { PaymentRequired, PaymentRequirements } from '@x402/core/types';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import type { WebcapConfig, X402Network } from '../config.js';
import { MAX_EXTRACT_BATCH } from './extract-parse.js';

export const X402_CAPTURE_PATTERN = 'POST /v1/x402/capture';
export const X402_CAPTURE_PATH = '/v1/x402/capture';
export const X402_EXTRACT_PATTERN = 'POST /v1/x402/extract';
export const X402_EXTRACT_PATH = '/v1/x402/extract';

const X402_VERSION = 2;
const X402_MAX_TIMEOUT_SECONDS = 300;
const X402_CAPTURE_DESCRIPTION = 'Capture a URL as PNG/JPEG/PDF + free OG metadata';
const X402_EXTRACT_DESCRIPTION = 'Capture a URL and return its structured content (title, headings, text, links, images) as JSON';
const X402_MIME_TYPE = 'application/json';

const BAZAAR_SERVICE_NAME = 'Webcap';
const BAZAAR_TAGS = ['screenshot', 'web-capture', 'pdf', 'markdown', 'text-extraction'];
const BAZAAR_HTTP_METHOD = 'POST';
// Placeholder payer for the bazaar output examples (never a real merchant address).
const BAZAAR_EXAMPLE_PAYER = '0x000000000000000000000000000000000000dEaD';

// EIP-712 domain of each chain's USDC deploy; a mismatch makes every
// payment signature unrecoverable (sepolia "USDC" vs mainnet "USD Coin").
const EIP712_DOMAINS: Record<X402Network, { readonly name: string; readonly version: string }> = {
  'eip155:84532': { name: 'USDC', version: '2' },
  'eip155:8453': { name: 'USD Coin', version: '2' },
};

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
function buildCaptureBazaarExtension(): BodyDiscoveryExtension {
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

function buildExtractBazaarExtension(): BodyDiscoveryExtension {
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

/** The payment requirement for an x402 route at a given price. */
export function buildX402Requirement(config: WebcapConfig, priceUsdcUnits: number): PaymentRequirements {
  const network = config.x402Network;
  if (network === undefined) throw new Error('x402 is disabled (WEBCAP_CHAIN=local)');
  return {
    scheme: 'exact',
    network,
    asset: config.x402Asset,
    amount: String(priceUsdcUnits),
    payTo: config.x402PayTo,
    maxTimeoutSeconds: X402_MAX_TIMEOUT_SECONDS,
    extra: EIP712_DOMAINS[network],
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

interface X402RouteSpec {
  readonly requirement: PaymentRequirements;
  readonly resourceUrl: string;
  readonly description: string;
  readonly serviceName: string;
  readonly tags: readonly string[];
  readonly iconUrl: string;
  readonly bazaar: BodyDiscoveryExtension;
}

/** Assemble one x402 RouteConfig: payment option + bazaar service metadata + 402 body mirror. */
function x402RouteConfig(spec: X402RouteSpec): RouteConfig {
  const { requirement, resourceUrl, description, serviceName, tags, iconUrl, bazaar } = spec;
  const metadata: UnpaidBazaarMetadata = { resourceUrl, serviceName, tags, iconUrl, bazaar };
  return {
    accepts: {
      scheme: requirement.scheme,
      network: requirement.network,
      payTo: requirement.payTo,
      price: { asset: requirement.asset, amount: requirement.amount, extra: requirement.extra },
      maxTimeoutSeconds: requirement.maxTimeoutSeconds,
    },
    // Canonical public URL (the app sees its own inbound traffic as http:// via the
    // tunnel); CDP's bazaar discovery requires resource.url to be https://.
    resource: resourceUrl,
    description,
    mimeType: X402_MIME_TYPE,
    serviceName,
    tags: [...tags],
    iconUrl,
    extensions: { bazaar },
    unpaidResponseBody: () => ({
      contentType: X402_MIME_TYPE,
      body: buildUnpaidBody(requirement, description, metadata),
    }),
  };
}

export function buildX402Routes(config: WebcapConfig): RoutesConfig {
  const captureReq = buildX402Requirement(config, config.x402PriceUsdcUnits);
  const extractReq = buildX402Requirement(config, config.x402ExtractPriceUsdcUnits);
  const iconUrl = `${config.publicBaseUrl}/icon.png`;
  const routes: RoutesConfig = {
    [X402_CAPTURE_PATTERN]: x402RouteConfig({
      requirement: captureReq,
      resourceUrl: `${config.publicBaseUrl}${X402_CAPTURE_PATH}`,
      description: X402_CAPTURE_DESCRIPTION,
      serviceName: BAZAAR_SERVICE_NAME,
      tags: BAZAAR_TAGS,
      iconUrl,
      bazaar: buildCaptureBazaarExtension(),
    }),
    [X402_EXTRACT_PATTERN]: x402RouteConfig({
      requirement: extractReq,
      resourceUrl: `${config.publicBaseUrl}${X402_EXTRACT_PATH}`,
      description: X402_EXTRACT_DESCRIPTION,
      serviceName: BAZAAR_SERVICE_NAME,
      tags: BAZAAR_TAGS,
      iconUrl,
      bazaar: buildExtractBazaarExtension(),
    }),
  };
  // Startup guard: flag malformed bazaar metadata at boot (the fastify middleware
  // independently auto-registers the bazaar resource server extension for these routes).
  validateBazaarRouteExtensions(routes);
  return routes;
}

/**
 * Register the x402 payment hooks (onRequest verify / onSend settle /
 * onError cancel) ahead of the routes. No-op when x402 is disabled.
 */
export function registerX402Middleware(
  app: FastifyInstance,
  config: WebcapConfig,
  facilitator: FacilitatorClient | undefined,
): void {
  const network = config.x402Network;
  if (network === undefined) return;
  if (facilitator === undefined) {
    throw new Error('x402 is enabled but no facilitator client was provided');
  }
  const resourceServer = new x402ResourceServer(facilitator).register(network, new ExactEvmScheme());
  paymentMiddleware(app, buildX402Routes(config), resourceServer);
}

/** Payer EOA address from the verified payment context, if any. */
export function x402Payer(req: FastifyRequest): string | undefined {
  const payload = req.x402Context?.paymentPayload?.payload;
  if (payload === undefined) return undefined;
  const auth = payload['authorization'];
  if (typeof auth !== 'object' || auth === null) return undefined;
  const from = (auth as { from?: unknown }).from;
  return typeof from === 'string' ? from : undefined;
}
