import { describe, expect, it } from 'vitest';
import { closeApiFixture, makeApiFixture } from './fixture.js';

describe('agent discovery aliases + trust surface (agent.json, x402.json, security.txt, transparency)', () => {
  it('agent.json: 200, byte-identical to agent-card.json', async () => {
    const fx = makeApiFixture();
    try {
      const canonical = await fx.app.inject({ method: 'GET', url: '/.well-known/agent-card.json' });
      expect(canonical.statusCode).toBe(200);
      const alias = await fx.app.inject({ method: 'GET', url: '/.well-known/agent.json' });
      expect(alias.statusCode).toBe(200);
      expect(String(alias.headers['content-type'])).toContain('application/json');
      expect(alias.payload).toBe(canonical.payload);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('x402.json: 200, byte-identical to the extensionless x402 catalog', async () => {
    const fx = makeApiFixture();
    try {
      const canonical = await fx.app.inject({ method: 'GET', url: '/.well-known/x402' });
      expect(canonical.statusCode).toBe(200);
      const alias = await fx.app.inject({ method: 'GET', url: '/.well-known/x402.json' });
      expect(alias.statusCode).toBe(200);
      expect(String(alias.headers['content-type'])).toContain('application/json');
      expect(alias.payload).toBe(canonical.payload);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('security.txt: 200 text/plain with Contact + Expires', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/.well-known/security.txt' });
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['content-type'])).toContain('text/plain');
      expect(res.payload).toContain('Contact: https://github.com/shoutsid-lab/webcap/security/advisories/new');
      expect(res.payload).toMatch(/^Expires: \d{4}-\d{2}-\d{2}T/m);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('transparency: 200 HTML with live stats labels, merchant wallet, and prices', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/transparency' });
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['content-type'])).toBe('text/html; charset=utf-8');
      expect(res.payload).toContain('<title>Transparency — webcap</title>');
      expect(res.payload).toContain('paid calls settled');
      expect(res.payload).toContain('payment challenges served');
      expect(res.payload).toContain(fx.config.x402PayTo);
      expect(res.payload).toContain('POST /v1/x402/analyze');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('sitemap.xml advertises /transparency', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/sitemap.xml' });
      expect(res.statusCode).toBe(200);
      const base = fx.config.publicBaseUrl.replace(/^http:\/\//, 'https://');
      expect(res.payload).toContain(`<loc>${base}/transparency</loc>`);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('x402-resources aliases: 200, byte-identical to the extensionless x402 catalog', async () => {
    const fx = makeApiFixture();
    try {
      const canonical = await fx.app.inject({ method: 'GET', url: '/.well-known/x402' });
      expect(canonical.statusCode).toBe(200);
      for (const path of ['/.well-known/x402-resources', '/x402-resources']) {
        const alias = await fx.app.inject({ method: 'GET', url: path });
        expect(alias.statusCode).toBe(200);
        expect(String(alias.headers['content-type'])).toContain('application/json');
        expect(alias.payload).toBe(canonical.payload);
      }
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('402index-verify.txt: absent by default (no claim in progress -> 404)', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/.well-known/402index-verify.txt' });
      expect(res.statusCode).toBe(404);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('402index-verify.txt: serves the configured hash verbatim as text/plain when set', async () => {
    const hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const fx = makeApiFixture({ indexVerifyHash: hash });
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/.well-known/402index-verify.txt' });
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['content-type'])).toContain('text/plain');
      expect(res.headers['cache-control']).toBe('no-store');
      // exactly the hash, no wrapper text (the registry hashes the body)
      expect(res.payload).toBe(hash);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('openapi.json documents the new discovery paths', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/openapi.json' });
      expect(res.statusCode).toBe(200);
      const doc = res.json() as { paths: Record<string, unknown> };
      for (const p of ['/.well-known/agent.json', '/.well-known/x402.json', '/.well-known/x402-resources', '/x402-resources', '/.well-known/security.txt', '/transparency']) {
        expect(doc.paths, `openapi must document ${p}`).toHaveProperty(p);
      }
    } finally {
      await closeApiFixture(fx);
    }
  });
});
