import { describe, expect, it } from 'vitest';
import { validateBazaarRouteExtensions, type BodyDiscoveryExtension } from '@x402/extensions/bazaar';
import type { RouteConfig } from '@x402/core/server';
import { PACKS, watchTopUpPriceUsdcUnits, type WebcapConfig } from '../../src/config.js';
import { openDb } from '../../src/db/index.js';
import { makeWatchRepo } from '../../src/watch/store.js';
import {
  buildUnpaidBody,
  buildX402Requirement,
  buildX402Routes,
  buildX402TopUpRoute,
  topUpOutputExample,
  type UnpaidBazaarMetadata,
  X402_CAPTURE_PATTERN,
  X402_EXTRACT_PATTERN,
} from '../../src/server/x402.js';

const SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const MERCHANT_ADDRESS = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';

/** x402-enabled config literal (pattern of tests/api/fixture.ts, base-sepolia network). */
function makeConfig(): WebcapConfig {
  return {
    chain: {
      name: 'base-sepolia',
      rpcUrl: 'https://sepolia.base.org',
      chainId: 84532,
      usdcContract: SEPOLIA_USDC,
      explorer: 'https://sepolia.basescan.org',
    },
    chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
    usdcAddress: SEPOLIA_USDC,
    merchantAddress: MERCHANT_ADDRESS,
    port: 0,
    pollIntervalMs: 5_000,
    merchantPrivateKey: '',
    dbPath: 'data/webcap.db',
    x402Network: 'eip155:84532',
    x402Asset: SEPOLIA_USDC,
    x402PayTo: MERCHANT_ADDRESS,
    x402PriceUsdcUnits: 1_000,
    x402ExtractPriceUsdcUnits: 10_000,
    x402AuditPriceUsdcUnits: 2_000,
    computeCostUsdcUnitsPerRequest: 200,
    modelApiBaseUrl: '',
    modelApiKey: '',
    modelName: '',
    x402FacilitatorUrl: 'https://x402.org/facilitator',
    publicBaseUrl: 'http://localhost:8080',
    cdpApiKey: undefined,
  };
}

function bazaarOf(route: { readonly extensions?: Record<string, unknown> }): BodyDiscoveryExtension {
  const ext = route.extensions?.['bazaar'];
  expect(ext).toBeDefined();
  return ext as BodyDiscoveryExtension;
}

function objectKeyCount(value: unknown): number {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return -1;
  return Object.keys(value).length;
}

describe('x402 bazaar discovery (service metadata + route extensions)', () => {
  const config = makeConfig();
  // buildX402Routes returns the RoutesConfig union; it is always the multi-route map form here.
  const routes = buildX402Routes(config) as Record<string, RouteConfig>;

  for (const pattern of [X402_CAPTURE_PATTERN, X402_EXTRACT_PATTERN]) {
    describe(pattern, () => {
      const route = routes[pattern];

      it('carries the webcap service metadata (serviceName, exactly 5 unique tags, iconUrl)', () => {
        expect(route).toBeDefined();
        expect(route?.serviceName).toBe('Webcap');
        const tags = route?.tags ?? [];
        expect(tags).toHaveLength(5);
        expect(tags.every((tag) => /^[!-~]{1,32}$/.test(tag))).toBe(true);
        expect(new Set(tags.map((tag) => tag.toLowerCase())).size).toBe(5);
        expect(route?.iconUrl).toBe(`${config.publicBaseUrl}/icon.png`);
      });

      it('pins resource to the canonical public URL (CDP bazaar discovery requires https://)', () => {
        expect(route).toBeDefined();
        const path = pattern.startsWith('POST /v1/x402/capture') ? '/v1/x402/capture' : '/v1/x402/extract';
        expect(route?.resource).toBe(`${config.publicBaseUrl}${path}`);
      });

      it('declares a bazaar extension: http POST json with a non-empty example body and object output example', () => {
        const bazaar = bazaarOf(route ?? {});
        expect(bazaar.info.input.type).toBe('http');
        expect(bazaar.info.input.method).toBe('POST');
        expect(bazaar.info.input.bodyType).toBe('json');
        expect(objectKeyCount(bazaar.info.input.body)).toBeGreaterThan(0);
        expect(bazaar.info.output?.example).toBeDefined();
        expect(objectKeyCount(bazaar.info.output?.example)).toBeGreaterThan(0);
      });
    });
  }

  it('capture bazaar schema describes the real capture request (required url, format enum png|jpeg|pdf)', () => {
    const route = routes[X402_CAPTURE_PATTERN];
    expect(route).toBeDefined();
    const body = bazaarOf(route ?? {}).schema.properties.input.properties.body;
    expect(body['type']).toBe('object');
    expect(body['required']).toEqual(expect.arrayContaining(['url']));
    const props = body['properties'] as Record<string, unknown>;
    expect(props['url']).toMatchObject({ type: 'string' });
    expect(props['format']).toMatchObject({ type: 'string', enum: ['png', 'jpeg', 'pdf'] });
  });

  it('extract bazaar schema describes url (string) and urls (string[] maxItems 10) per parseExtractUrls', () => {
    const route = routes[X402_EXTRACT_PATTERN];
    expect(route).toBeDefined();
    const body = bazaarOf(route ?? {}).schema.properties.input.properties.body;
    expect(body['type']).toBe('object');
    const props = body['properties'] as Record<string, unknown>;
    expect(props['url']).toMatchObject({ type: 'string' });
    expect(props['urls']).toMatchObject({ type: 'array', maxItems: 10 });
    expect((props['urls'] as { items: unknown })['items']).toMatchObject({ type: 'string' });
  });

  it('validateBazaarRouteExtensions does not throw on buildX402Routes output', () => {
    expect(() => validateBazaarRouteExtensions(routes)).not.toThrow();
  });

  it('topUpOutputExample is derived from config (starter-pack credits, capture-mode pack price)', () => {
    const example = topUpOutputExample(config) as { watchId: string; credits: number; priceUsdcUnits: number };
    expect(example.watchId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(example.credits).toBe(PACKS.starter.credits);
    expect(example.priceUsdcUnits).toBe(watchTopUpPriceUsdcUnits('capture', config));
  });

  it('the top-up bazaar extension advertises the config-derived output example', () => {
    const db = openDb(':memory:');
    try {
      const route = buildX402TopUpRoute(config, makeWatchRepo(db));
      const example = (bazaarOf(route).info.output?.example ?? undefined) as Record<string, unknown> | undefined;
      expect(example).toEqual(topUpOutputExample(config));
    } finally {
      db.close();
    }
  });

  it('buildUnpaidBody mirrors service metadata + bazaar extension into the 402 PaymentRequired body', () => {
    const cases: Array<[string, number]> = [
      [X402_CAPTURE_PATTERN, config.x402PriceUsdcUnits],
      [X402_EXTRACT_PATTERN, config.x402ExtractPriceUsdcUnits],
    ];
    for (const [pattern, priceUnits] of cases) {
      const route = routes[pattern];
      expect(route).toBeDefined();
      const metadata: UnpaidBazaarMetadata = {
        resourceUrl: route?.resource ?? '',
        serviceName: route?.serviceName ?? '',
        tags: route?.tags ?? [],
        iconUrl: route?.iconUrl ?? '',
        bazaar: bazaarOf(route ?? {}),
      };
      const body = buildUnpaidBody(buildX402Requirement(config, priceUnits), '', metadata);
      expect(body.x402Version).toBe(2);
      expect(body.error).toBe('Payment required');
      expect(body.resource.url).toBe(metadata.resourceUrl);
      expect(body.resource.serviceName).toBe('Webcap');
      expect(body.resource.tags).toHaveLength(5);
      expect(body.resource.iconUrl).toBe(`${config.publicBaseUrl}/icon.png`);
      const bodyBazaar = body.extensions?.['bazaar'] as BodyDiscoveryExtension | undefined;
      expect(bodyBazaar).toBeDefined();
      expect(bodyBazaar?.info.input.type).toBe('http');
      // the body is a static mirror: method must be present without server enrichment
      expect(bodyBazaar?.info.input.method).toBe('POST');
      expect(bodyBazaar?.info.input.bodyType).toBe('json');
    }
  });

  it('buildUnpaidBody pins the bazaar method to the passed request method', () => {
    const route = routes[X402_CAPTURE_PATTERN];
    expect(route).toBeDefined();
    const metadata: UnpaidBazaarMetadata = {
      resourceUrl: route?.resource ?? '',
      serviceName: route?.serviceName ?? '',
      tags: route?.tags ?? [],
      iconUrl: route?.iconUrl ?? '',
      bazaar: bazaarOf(route ?? {}),
    };
    const body = buildUnpaidBody(buildX402Requirement(config, config.x402PriceUsdcUnits), 'desc', metadata, 'GET');
    const bodyBazaar = body.extensions?.['bazaar'] as BodyDiscoveryExtension | undefined;
    expect(bodyBazaar).toBeDefined();
    expect(bodyBazaar?.info.input.method).toBe('GET');
    const methodProp = bodyBazaar?.schema.properties.input.properties.method as { enum?: readonly string[] } | undefined;
    expect(methodProp?.enum).toEqual(['GET']);
  });

  it('buildUnpaidBody defaults the bazaar method to POST when no method is passed (backward compat)', () => {
    const route = routes[X402_CAPTURE_PATTERN];
    expect(route).toBeDefined();
    const metadata: UnpaidBazaarMetadata = {
      resourceUrl: route?.resource ?? '',
      serviceName: route?.serviceName ?? '',
      tags: route?.tags ?? [],
      iconUrl: route?.iconUrl ?? '',
      bazaar: bazaarOf(route ?? {}),
    };
    const body = buildUnpaidBody(buildX402Requirement(config, config.x402PriceUsdcUnits), 'desc', metadata);
    const bodyBazaar = body.extensions?.['bazaar'] as BodyDiscoveryExtension | undefined;
    expect(bodyBazaar).toBeDefined();
    expect(bodyBazaar?.info.input.method).toBe('POST');
    const methodProp = bodyBazaar?.schema.properties.input.properties.method as { enum?: readonly string[] } | undefined;
    expect(methodProp?.enum).toEqual(['POST']);
  });
});
