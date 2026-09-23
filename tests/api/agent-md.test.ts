import { describe, expect, it } from 'vitest';
import { closeApiFixture, makeApiFixture } from './fixture.js';

/**
 * GET /AGENT.md — the repo-root agent guide is advertised by the front-door
 * `agentGuide` label, so it must resolve over HTTP (it 404'd) with the
 * deployment base URL interpolated (the repo file carries a
 * `<webcap-url>` placeholder).
 */
describe('GET /AGENT.md — served agent guide', () => {
  it('serves 200 markdown with the base URL interpolated and no placeholders', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/AGENT.md' });
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['content-type'])).toContain('text/markdown');
      const body = res.body;
      expect(body).toContain(fx.config.publicBaseUrl);
      expect(body).not.toContain('<webcap-url>');
      expect(body).not.toContain('failed to load on this deployment');
      expect(body).toContain('/v1/x402/capture');
      expect(body).toContain('/v1/x402/extract');
    } finally {
      await closeApiFixture(fx);
    }
  });
});
