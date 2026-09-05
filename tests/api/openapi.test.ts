import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { watchTopUpPriceUsdcUnits } from '../../src/config.js';
import { closeApiFixture, makeApiFixture } from './fixture.js';

interface OpenapiOperationView {
  readonly responses: Record<string, unknown>;
}

interface OpenapiDocView {
  readonly openapi: string;
  readonly info: { title: string; version: string };
  readonly servers: Array<{ url: string }>;
  readonly paths: Record<string, Record<string, OpenapiOperationView | undefined>>;
}

interface ChallengeSchemaView {
  readonly properties: {
    readonly resource: { properties: { url: { example: unknown } } };
    readonly accepts: { items: { properties: { amount: { example: unknown } } } };
  };
}

interface X402ChallengeDoc {
  readonly description: string;
  readonly headers?: Record<string, unknown>;
  readonly content?: Record<string, { schema: unknown }>;
}

/**
 * The method+path pairs registered on the app router, derived from Fastify's
 * radix-tree printRoutes output (no public route-list API exists). Tree lines
 * are 4-char indent units followed by a connector; route lines end with a
 * "(METHOD, METHOD)" suffix, internal nodes do not. Path labels split
 * mid-word in the radix tree, so the path is the concatenation of the labels
 * along the branch.
 */
function registeredRoutes(app: FastifyInstance): ReadonlyArray<{ method: string; path: string }> {
  const routes: Array<{ method: string; path: string }> = [];
  const labels: string[] = [];
  for (const line of app.printRoutes().split('\n')) {
    let i = 0;
    while (line.startsWith('│   ', i) || line.startsWith('    ', i)) {
      i += 4;
    }
    const connector = line.slice(i, i + 4);
    if (connector !== '├── ' && connector !== '└── ') continue;
    const rest = line.slice(i + 4);
    const depth = i / 4;
    const match = /^(.*) \(([A-Z]+(?:, [A-Z]+)*)\)$/.exec(rest);
    if (match === null) {
      labels[depth] = rest;
      continue;
    }
    const label = match[1];
    const methods = match[2];
    if (label === undefined || methods === undefined) continue;
    labels[depth] = label;
    const path = labels.slice(0, depth + 1).join('');
    for (const method of methods.split(', ')) {
      routes.push({ method, path });
    }
  }
  return routes;
}

/** Fastify ":param" segments -> OpenAPI "{param}" path template. */
function toOpenApiPath(path: string): string {
  return path.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, (segment) => `{${segment.slice(1)}}`);
}

function getDoc(app: FastifyInstance) {
  return app.inject({ method: 'GET', url: '/openapi.json' });
}

describe('GET /openapi.json (machine-readable catalog)', () => {
  it('returns the OpenAPI 3.1 document with the paid x402 paths and their 402 semantics', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/openapi.json' });
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['content-type'])).toContain('application/json');
      const doc = res.json() as OpenapiDocView;
      expect(doc.openapi.startsWith('3.1')).toBe(true);
      expect(doc.info.title).toBe('webcap');
      const serverUrls = doc.servers.map((s) => s.url);
      expect(serverUrls).toContain(fx.config.publicBaseUrl);
      expect(serverUrls).toContain('http://localhost:8080');

      const capture = doc.paths['/v1/x402/capture']?.post;
      const extract = doc.paths['/v1/x402/extract']?.post;
      expect(capture).toBeDefined();
      expect(extract).toBeDefined();
      // 200 success + documented 402 x402 payment-required + 400 bad input
      expect(capture?.responses['200']).toBeDefined();
      expect(extract?.responses['200']).toBeDefined();
      expect(capture?.responses['402']).toBeDefined();
      expect(extract?.responses['402']).toBeDefined();
      expect(capture?.responses['400']).toBeDefined();
      expect(extract?.responses['400']).toBeDefined();
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('covers the free, artifact, discovery and landing paths', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/openapi.json' });
      const doc = res.json() as OpenapiDocView;
      expect(doc.paths['/v1/extract/preview']?.get?.responses['200']).toBeDefined();
      expect(doc.paths['/v1/artifacts/{id}']?.get?.responses['200']).toBeDefined();
      expect(doc.paths['/v1/artifacts/{id}']?.get?.responses['404']).toBeDefined();
      expect(doc.paths['/v1/artifacts/{id}/page']?.get?.responses['200']).toBeDefined();
      expect(doc.paths['/v1/artifacts/{id}/page']?.get?.responses['404']).toBeDefined();
      expect(doc.paths['/']?.get?.responses['200']).toBeDefined();
      expect(doc.paths['/icon.png']?.get?.responses['200']).toBeDefined();
      expect(doc.paths['/openapi.json']?.get?.responses['200']).toBeDefined();
      expect(doc.paths['/v1/x402/service']?.get?.responses['200']).toBeDefined();
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('serves a parseable OpenAPI 3.1 document: absolute paths, known methods, a success response per operation', async () => {
    const fx = makeApiFixture();
    try {
      const res = await getDoc(fx.app);
      expect(res.statusCode).toBe(200);
      const doc: unknown = JSON.parse(res.payload);
      expect(typeof doc).toBe('object');
      expect(doc).not.toBeNull();
      const view = doc as OpenapiDocView;
      expect(view.openapi.startsWith('3.1')).toBe(true);
      const paths = Object.keys(view.paths);
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path.startsWith('/'), `${path} must be an absolute path template`).toBe(true);
        for (const [method, op] of Object.entries(view.paths[path] ?? {})) {
          expect(['get', 'put', 'post', 'delete', 'options', 'head', 'patch'].includes(method), `${path} has unknown method ${method}`).toBe(true);
          const success = Object.keys(op?.responses ?? {}).some((status) => status.startsWith('2'));
          expect(success, `${method.toUpperCase()} ${path} must document a 2xx success response`).toBe(true);
        }
      }
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('documents every route registered on the app router', async () => {
    const fx = makeApiFixture();
    try {
      const res = await getDoc(fx.app);
      const doc = res.json() as OpenapiDocView;
      const registered = registeredRoutes(fx.app);
      expect(registered.length).toBeGreaterThanOrEqual(20);
      const missing = registered.flatMap(({ method, path }) => {
        // Fastify serves HEAD for every GET route; the catalog documents GET.
        // OpenAPI method keys are lowercase; printRoutes prints uppercase.
        const methodKey = method === 'HEAD' ? 'get' : method.toLowerCase();
        const op = doc.paths[toOpenApiPath(path)]?.[methodKey];
        return op === undefined ? [`${method} ${path}`] : [];
      });
      expect(missing).toEqual([]);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('declares a 402 challenge carrying the config price and resource on every x402 paid route', async () => {
    const fx = makeApiFixture();
    try {
      const res = await getDoc(fx.app);
      const doc = res.json() as OpenapiDocView;
      const cases: Array<[string, number]> = [
        ['/v1/x402/capture', fx.config.x402PriceUsdcUnits],
        ['/v1/x402/extract', fx.config.x402ExtractPriceUsdcUnits],
        // the top-up challenge is priced per watch mode; the static (no ?watchId=)
        // price is the capture-mode pack price
        ['/v1/x402/watches/topup', watchTopUpPriceUsdcUnits('capture', fx.config)],
      ];
      for (const [path, priceUsdcUnits] of cases) {
        const challenge = (doc.paths[path]?.post?.responses['402'] ?? undefined) as X402ChallengeDoc | undefined;
        expect(challenge, `POST ${path} must document a 402 response`).toBeDefined();
        expect(
          challenge?.headers?.['PAYMENT-REQUIRED'],
          `POST ${path} 402 must document the base64 PAYMENT-REQUIRED header`,
        ).toBeDefined();
        const schema = (challenge?.content?.['application/json']?.schema ?? undefined) as ChallengeSchemaView | undefined;
        expect(schema, `POST ${path} 402 must document the challenge JSON body schema`).toBeDefined();
        expect(schema?.properties.accepts.items.properties.amount.example, `POST ${path} 402 amount example`).toBe(
          String(priceUsdcUnits),
        );
        expect(schema?.properties.resource.properties.url.example, `POST ${path} 402 resource url example`).toBe(
          `${fx.config.publicBaseUrl}${path}`,
        );
      }
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('documents input validation as 422 unprocessable (error envelope) on the x402 capture/extract routes', async () => {
    const fx = makeApiFixture();
    try {
      const res = await getDoc(fx.app);
      const doc = res.json() as OpenapiDocView;
      for (const path of ['/v1/x402/capture', '/v1/x402/extract']) {
        const validation = (doc.paths[path]?.post?.responses['422'] ?? undefined) as X402ChallengeDoc | undefined;
        expect(validation, `POST ${path} must document 422 for invalid input (not 400-only)`).toBeDefined();
        expect(String(validation?.description ?? '')).toMatch(/unprocessable/);
        expect(validation?.content?.['application/json']?.schema).toEqual({ $ref: '#/components/schemas/Error' });
      }
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('documents 502 upstream capture failures where they can occur and 429 on the rate-limited preview', async () => {
    const fx = makeApiFixture();
    try {
      const res = await getDoc(fx.app);
      const doc = res.json() as OpenapiDocView;
      const captureFailureRoutes: Array<[string, string]> = [
        ['post', '/v1/x402/capture'],
        ['post', '/v1/x402/extract'],
        ['get', '/v1/extract/preview'],
        ['get', '/v1/og'],
      ];
      for (const [method, path] of captureFailureRoutes) {
        const failure = doc.paths[path]?.[method]?.responses['502'] as { description?: string } | undefined;
        expect(failure, `${method.toUpperCase()} ${path} must document 502`).toBeDefined();
        expect(String(failure?.description ?? '')).toMatch(/capture_failed|extract_failed/);
      }
      expect(doc.paths['/v1/extract/preview']?.get?.responses['429'], 'GET /v1/extract/preview must document 429').toBeDefined();
    } finally {
      await closeApiFixture(fx);
    }
  });
});
