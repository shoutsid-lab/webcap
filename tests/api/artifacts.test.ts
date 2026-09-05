import { describe, expect, it } from 'vitest';
import { closeApiFixture, FAKE_PNG, makeApiFixture } from './fixture.js';

const NO_AUTH_HEADERS = {};

describe('artifact store + GET /v1/artifacts/:id (public)', () => {
  it('POST /v1/capture returns a persistent artifact.url alongside the existing artifact fields', async () => {
    const fx = makeApiFixture();
    try {
      fx.credits.grantCredits(fx.accountId, 2, 'test_seed');
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/capture',
        payload: { url: 'https://example.com/' },
        headers: { authorization: `Bearer ${fx.apiKey}` },
      });
      expect(res.statusCode).toBe(200);
      const json = res.json() as {
        artifact: { format: string; bytes: number; data: string; url: string };
        creditsCharged: number;
        balance: number;
      };
      const prefix = `${fx.config.publicBaseUrl}/v1/artifacts/`;
      expect(json.artifact.url.startsWith(prefix)).toBe(true);
      const id = json.artifact.url.slice(prefix.length);
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(json.artifact.url).toBe(`${prefix}${id}`);
      // Existing fields are unchanged.
      expect(json.artifact.format).toBe('png');
      expect(json.artifact.bytes).toBe(FAKE_PNG.length);
      expect(Buffer.from(json.artifact.data, 'base64')).toEqual(FAKE_PNG);
      expect(json.creditsCharged).toBe(1);
      expect(json.balance).toBe(1);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('GET /v1/artifacts/:id (no auth) returns the exact stored bytes with the stored mime + length', async () => {
    const fx = makeApiFixture();
    try {
      fx.credits.grantCredits(fx.accountId, 1, 'test_seed');
      const cap = await fx.app.inject({
        method: 'POST',
        url: '/v1/capture',
        payload: { url: 'https://example.com/' },
        headers: { authorization: `Bearer ${fx.apiKey}` },
      });
      expect(cap.statusCode).toBe(200);
      const json = cap.json() as { artifact: { data: string; url: string } };
      const path = json.artifact.url.slice(fx.config.publicBaseUrl.length);
      const res = await fx.app.inject({ method: 'GET', url: path, headers: NO_AUTH_HEADERS });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['content-length']).toBe(String(FAKE_PNG.length));
      expect(Buffer.from(res.rawPayload)).toEqual(Buffer.from(json.artifact.data, 'base64'));
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('GET /v1/artifacts/:id is 404 for an unknown id', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({
        method: 'GET',
        url: '/v1/artifacts/00000000-0000-4000-8000-000000000000',
        headers: NO_AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(404);
      const envelope = res.json() as { error: { code: string } };
      expect(envelope.error.code).toBe('not_found');
    } finally {
      await closeApiFixture(fx);
    }
  });
});
