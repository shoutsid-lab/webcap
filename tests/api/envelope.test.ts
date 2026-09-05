import { describe, expect, it } from 'vitest';
import { closeApiFixture, errorEnvelope, makeApiFixture, type ApiFixture } from './fixture.js';

async function withApp(fn: (fx: ApiFixture) => Promise<void>): Promise<void> {
  const fx = makeApiFixture();
  try {
    await fn(fx);
  } finally {
    await closeApiFixture(fx);
  }
}

describe('error envelope for route-not-found and method-not-allowed', () => {
  it('returns the not_found envelope for an unknown route (GET /nope)', async () => {
    await withApp(async (fx) => {
      const res = await fx.app.inject({ method: 'GET', url: '/nope' });
      expect(res.statusCode).toBe(404);
      const envelope = errorEnvelope(res);
      expect(envelope.code).toBe('not_found');
      expect(envelope.message).toBe('route not found');
    });
  });

  it('returns 405 with an Allow header and the method_not_allowed envelope for a wrong method (DELETE /v1/health)', async () => {
    await withApp(async (fx) => {
      const res = await fx.app.inject({ method: 'DELETE', url: '/v1/health' });
      expect(res.statusCode).toBe(405);
      expect(res.headers['allow']).toBe('GET, HEAD');
      const envelope = errorEnvelope(res);
      expect(envelope.code).toBe('method_not_allowed');
      expect(envelope.message).toBe('method not allowed');
    });
  });

  it('returns 405 (not a body-parse 400) when the wrong-method request carries a JSON content-type', async () => {
    await withApp(async (fx) => {
      const res = await fx.app.inject({
        method: 'DELETE',
        url: '/v1/health',
        payload: '',
        headers: { 'content-type': 'application/json' },
      });
      expect(res.statusCode).toBe(405);
      expect(res.headers['allow']).toBe('GET, HEAD');
      expect(errorEnvelope(res).code).toBe('method_not_allowed');
    });
  });

  it('lists every valid method for a parameterized path in Allow (POST /v1/watches/:id)', async () => {
    await withApp(async (fx) => {
      const res = await fx.app.inject({ method: 'POST', url: '/v1/watches/abc123', payload: {} });
      expect(res.statusCode).toBe(405);
      expect(res.headers['allow']).toBe('GET, HEAD, DELETE');
      expect(errorEnvelope(res).code).toBe('method_not_allowed');
    });
  });

  it('returns the not_found envelope (not a body-parse 400) for an unknown path with a JSON content-type', async () => {
    await withApp(async (fx) => {
      const res = await fx.app.inject({
        method: 'DELETE',
        url: '/nope',
        payload: '',
        headers: { 'content-type': 'application/json' },
      });
      expect(res.statusCode).toBe(404);
      expect(errorEnvelope(res).code).toBe('not_found');
    });
  });

  it('keeps the 401 unauthorized envelope for a capture without an API key', async () => {
    await withApp(async (fx) => {
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/capture',
        payload: { url: 'https://example.com/' },
      });
      expect(res.statusCode).toBe(401);
      const envelope = errorEnvelope(res);
      expect(envelope.code).toBe('unauthorized');
      expect(envelope.message).toBe('missing bearer token');
    });
  });

  it('keeps the 400 bad_request envelope for a malformed watch body', async () => {
    await withApp(async (fx) => {
      const res = await fx.app.inject({ method: 'POST', url: '/v1/watches', payload: {} });
      expect(res.statusCode).toBe(400);
      const envelope = errorEnvelope(res);
      expect(envelope.code).toBe('bad_request');
      expect(envelope.message).toBe('url is required');
    });
  });
});
