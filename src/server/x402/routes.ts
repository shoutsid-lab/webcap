/**
 * The x402 RouteConfig assembly for webcap's paid routes: the payment
 * requirement derivation (buildX402Requirement), the per-route spec builders
 * (static capture/extract + the dynamic-price watch top-up), and the
 * startup-validated route tables (buildX402Routes / buildAllX402Routes). Split
 * out of x402.ts as a pure move (no behavior change); x402.ts re-exports
 * everything it used to.
 */
import { validateBazaarRouteExtensions, type BodyDiscoveryExtension } from '@x402/extensions/bazaar';
import type { HTTPRequestContext, RouteConfig, RoutesConfig } from '@x402/core/server';
import type { PaymentRequirements } from '@x402/core/types';
import { DEFAULT_X402_MAX_TIMEOUT_MS, EIP712_DOMAINS, watchTopUpPriceUsdcUnits, type WebcapConfig } from '../../config.js';
import type { WatchRepo } from '../../watch/store.js';
import {
  BAZAAR_SERVICE_NAME,
  BAZAAR_TAGS,
  X402_CAPTURE_DESCRIPTION,
  X402_AUDIT_DESCRIPTION,
  X402_EXTRACT_DESCRIPTION,
  X402_MAP_LITE_DESCRIPTION,
  X402_MIME_TYPE,
  X402_TOPUP_DESCRIPTION,
  buildCaptureBazaarExtension,
  buildAuditBazaarExtension,
  buildExtractBazaarExtension,
  buildMapLiteBazaarExtension,
  buildTopUpBazaarExtension,
  buildUnpaidBody,
  type UnpaidBazaarMetadata,
} from './challenges.js';

export const X402_CAPTURE_PATTERN = 'POST /v1/x402/capture';
export const X402_CAPTURE_PATH = '/v1/x402/capture';
export const X402_EXTRACT_PATTERN = 'POST /v1/x402/extract';
export const X402_EXTRACT_PATH = '/v1/x402/extract';
export const X402_AUDIT_PATTERN = 'POST /v1/x402/audit';
export const X402_AUDIT_PATH = '/v1/x402/audit';
export const X402_MAP_LITE_PATTERN = 'POST /v1/x402/map-lite';
export const X402_MAP_LITE_PATH = '/v1/x402/map-lite';
export const X402_TOPUP_PATTERN = 'POST /v1/x402/watches/topup';
export const X402_TOPUP_PATH = '/v1/x402/watches/topup';

/**
 * The challenge amount for a top-up request: 100 x the watch's mode unit
 * price. Fastify has not parsed the request body yet when the x402 middleware
 * runs (onRequest precedes body parsing), so the watch is resolved from the
 * ?watchId= query parameter — clients include it alongside the {watchId,
 * runs} body. An unknown/absent watch falls back to the capture-mode pack
 * price; the route handler then 404s/400s and the settlement for that
 * request is cancelled (the payer is not charged).
 */
function topUpPriceUsdcUnitsForContext(context: HTTPRequestContext, watchRepo: WatchRepo, config: WebcapConfig): number {
  const adapter = context.adapter;
  const raw = typeof adapter.getQueryParam === 'function' ? adapter.getQueryParam('watchId') : undefined;
  const watchId =
    typeof raw === 'string' && raw !== ''
      ? raw
      : Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'string'
        ? raw[0]
        : undefined;
  const watch = watchId !== undefined ? watchRepo.get(watchId) : null;
  return watch !== null
    ? watchTopUpPriceUsdcUnits(watch.mode, config)
    : watchTopUpPriceUsdcUnits('capture', config);
}

/**
 * The x402 RouteConfig for POST /v1/x402/watches/topup. The price is a
 * DynamicPrice (resolved per request from ?watchId=) because the 100-run pack
 * price depends on the watch's mode.
 */
export function buildX402TopUpRoute(config: WebcapConfig, watchRepo: WatchRepo): RouteConfig {
  const requirement = buildX402Requirement(config, watchTopUpPriceUsdcUnits('capture', config));
  const metadata: UnpaidBazaarMetadata = {
    resourceUrl: `${config.publicBaseUrl}${X402_TOPUP_PATH}`,
    serviceName: BAZAAR_SERVICE_NAME,
    tags: BAZAAR_TAGS,
    iconUrl: `${config.publicBaseUrl}/icon.png`,
    bazaar: buildTopUpBazaarExtension(config),
  };
  return {
    accepts: {
      scheme: requirement.scheme,
      network: requirement.network,
      payTo: requirement.payTo,
      // AssetAmount form (atomic string), NOT a bare number: a numeric price is
      // a Money amount in USD that the library scales by the asset's decimals
      // (100000 would become 100000000000 units of USDC).
      price: (context: HTTPRequestContext) => ({
        asset: requirement.asset,
        amount: String(topUpPriceUsdcUnitsForContext(context, watchRepo, config)),
        extra: requirement.extra,
      }),
      maxTimeoutSeconds: requirement.maxTimeoutSeconds,
      extra: requirement.extra,
    },
    resource: metadata.resourceUrl,
    description: X402_TOPUP_DESCRIPTION,
    mimeType: X402_MIME_TYPE,
    serviceName: BAZAAR_SERVICE_NAME,
    tags: [...BAZAAR_TAGS],
    iconUrl: metadata.iconUrl,
    extensions: { bazaar: metadata.bazaar },
    // Static mirror of the enriched PAYMENT-REQUIRED header (same per-request
    // price resolution and method, so the JSON body equals the header challenge).
    unpaidResponseBody: (context: HTTPRequestContext) => ({
      contentType: X402_MIME_TYPE,
      body: buildUnpaidBody(
        buildX402Requirement(config, topUpPriceUsdcUnitsForContext(context, watchRepo, config)),
        X402_TOPUP_DESCRIPTION,
        metadata,
        context.method,
      ),
    }),
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
    maxTimeoutSeconds: Math.round((config.x402MaxTimeoutMs ?? DEFAULT_X402_MAX_TIMEOUT_MS) / 1000),
    extra: EIP712_DOMAINS[network],
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
    // The route config serves both the POST and GET patterns; mirror the
    // request's actual method so GET 402 bodies match their enriched header.
    unpaidResponseBody: (context: HTTPRequestContext) => ({
      contentType: X402_MIME_TYPE,
      body: buildUnpaidBody(requirement, description, metadata, context.method),
    }),
  };
}

export function buildX402Routes(config: WebcapConfig): Record<string, RouteConfig> {
  const captureReq = buildX402Requirement(config, config.x402PriceUsdcUnits);
  const extractReq = buildX402Requirement(config, config.x402ExtractPriceUsdcUnits);
  const auditReq = buildX402Requirement(config, config.x402AuditPriceUsdcUnits);
  const mapLiteReq = buildX402Requirement(config, config.x402AuditPriceUsdcUnits);
  const iconUrl = `${config.publicBaseUrl}/icon.png`;
  // Register both POST and GET for each route. POST is the real payment method;
  // GET returns an identical 402 challenge so GET-based crawlers (402index, search
  // indexers) can discover and verify the route without a payer — byte-identical
  // challenge, no behavior change for POST callers.
  const captureRoute = x402RouteConfig({
    requirement: captureReq,
    resourceUrl: `${config.publicBaseUrl}${X402_CAPTURE_PATH}`,
    description: X402_CAPTURE_DESCRIPTION,
    serviceName: BAZAAR_SERVICE_NAME,
    tags: BAZAAR_TAGS,
    iconUrl,
    bazaar: buildCaptureBazaarExtension(),
  });
  const extractRoute = x402RouteConfig({
    requirement: extractReq,
    resourceUrl: `${config.publicBaseUrl}${X402_EXTRACT_PATH}`,
    description: X402_EXTRACT_DESCRIPTION,
    serviceName: BAZAAR_SERVICE_NAME,
    tags: BAZAAR_TAGS,
    iconUrl,
    bazaar: buildExtractBazaarExtension(),
  });
  const auditRoute = x402RouteConfig({
    requirement: auditReq,
    resourceUrl: `${config.publicBaseUrl}${X402_AUDIT_PATH}`,
    description: X402_AUDIT_DESCRIPTION,
    serviceName: BAZAAR_SERVICE_NAME,
    tags: BAZAAR_TAGS,
    iconUrl,
    bazaar: buildAuditBazaarExtension(),
  });
  const mapLiteRoute = x402RouteConfig({
    requirement: mapLiteReq,
    resourceUrl: `${config.publicBaseUrl}${X402_MAP_LITE_PATH}`,
    description: X402_MAP_LITE_DESCRIPTION,
    serviceName: BAZAAR_SERVICE_NAME,
    tags: BAZAAR_TAGS,
    iconUrl,
    bazaar: buildMapLiteBazaarExtension(),
  });
  const routes: RoutesConfig = {
    [X402_CAPTURE_PATTERN]: captureRoute,
    [`GET ${X402_CAPTURE_PATH}`]: captureRoute,
    [X402_EXTRACT_PATTERN]: extractRoute,
    [`GET ${X402_EXTRACT_PATH}`]: extractRoute,
    [X402_AUDIT_PATTERN]: auditRoute,
    [`GET ${X402_AUDIT_PATH}`]: auditRoute,
    [X402_MAP_LITE_PATTERN]: mapLiteRoute,
    [`GET ${X402_MAP_LITE_PATH}`]: mapLiteRoute,
  };
  // Startup guard: flag malformed bazaar metadata at boot (the fastify middleware
  // independently auto-registers the bazaar resource server extension for these routes).
  validateBazaarRouteExtensions(routes);
  return routes;
}

/**
 * All x402-gated routes: the two static-price routes plus the watch top-up
 * route (dynamic price; needs the watch store). Startup-validated.
 */
export function buildAllX402Routes(config: WebcapConfig, watchRepo: WatchRepo): Record<string, RouteConfig> {
  const routes = buildX402Routes(config);
  const topUpRoute = buildX402TopUpRoute(config, watchRepo);
  routes[X402_TOPUP_PATTERN] = topUpRoute;
  routes[`GET ${X402_TOPUP_PATH}`] = topUpRoute;
  validateBazaarRouteExtensions(routes);
  return routes;
}
