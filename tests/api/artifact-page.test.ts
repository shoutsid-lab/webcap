import { describe, expect, it } from 'vitest';
import { makeArtifactRepo } from '../../src/db/artifacts.js';
import { FAKE_PNG, closeApiFixture, makeApiFixture } from './fixture.js';

const SOURCE = 'https://example.com/';

async function captureArtifactUrl(fx: ReturnType<typeof makeApiFixture>): Promise<string> {
  fx.credits.grantCredits(fx.accountId, 1, 'test_seed');
  const cap = await fx.app.inject({
    method: 'POST',
    url: '/v1/capture',
    payload: { url: SOURCE },
    headers: { authorization: `Bearer ${fx.apiKey}` },
  });
  expect(cap.statusCode).toBe(200);
  const json = cap.json() as { artifact: { url: string } };
  return json.artifact.url;
}

describe('GET /v1/artifacts/:id/page (shareable artifact page)', () => {
  it('returns a 200 HTML page with OG tags, the embedded capture and metadata', async () => {
    const fx = makeApiFixture();
    try {
      const publicUrl = await captureArtifactUrl(fx);
      const path = publicUrl.slice(fx.config.publicBaseUrl.length);
      const res = await fx.app.inject({ method: 'GET', url: `${path}/page` });
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['content-type'])).toBe('text/html; charset=utf-8');
      const html = res.payload;
      expect(html).toContain(`<meta property="og:image" content="${publicUrl}">`);
      expect(html).toContain(`<meta property="og:url" content="${publicUrl}">`);
      expect(html).toContain('<meta property="og:type" content="website">');
      expect(html).toMatch(/<meta property="og:title" content="[^"]+">/);
      expect(html).toMatch(/<meta property="og:description" content="[^"]+">/);
      expect(html).toContain(`<img src="${publicUrl}"`);
      expect(html).toContain(SOURCE);
      expect(html).toContain('href="/"');
      // metadata: format, human-readable size, captured-at
      expect(html).toContain('<dt>format</dt><dd>png</dd>');
      expect(html).toContain(`<dt>size</dt><dd>${FAKE_PNG.length} B</dd>`);
      expect(html).toMatch(/<dt>captured<\/dt><dd>\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC<\/dd>/);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('returns 404 with the same envelope as the artifact route for an unknown id', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({
        method: 'GET',
        url: '/v1/artifacts/00000000-0000-4000-8000-000000000000/page',
      });
      expect(res.statusCode).toBe(404);
      const envelope = res.json() as { error: { code: string } };
      expect(envelope.error.code).toBe('not_found');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('escapes user-influenced values against HTML injection', async () => {
    const fx = makeApiFixture();
    try {
      const artifacts = makeArtifactRepo(fx.db);
      const id = crypto.randomUUID();
      artifacts.store({
        id,
        sourceUrl: 'https://example.com/a<b>"c\'d',
        format: 'png',
        mime: 'image/png',
        bytes: FAKE_PNG,
      });
      const res = await fx.app.inject({ method: 'GET', url: `/v1/artifacts/${id}/page` });
      expect(res.statusCode).toBe(200);
      const html = res.payload;
      expect(html).toContain('https://example.com/a&lt;b&gt;&quot;c&#39;d');
      expect(html).not.toContain('a<b>"c');
    } finally {
      await closeApiFixture(fx);
    }
  });
});
