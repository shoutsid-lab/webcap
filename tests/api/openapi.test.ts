import { describe, expect, it } from 'vitest';
import { closeApiFixture, makeApiFixture } from './fixture.js';

interface OpenapiOperationView {
  readonly responses: Record<string, unknown>;
}

interface OpenapiDocView {
  readonly openapi: string;
  readonly info: { title: string; version: string };
  readonly servers: Array<{ url: string }>;
  readonly paths: Record<string, { post?: OpenapiOperationView; get?: OpenapiOperationView }>;
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
});
