import { describe, expect, it } from 'vitest';
import { closeApiFixture, makeApiFixture } from './fixture.js';

describe('GET / (content negotiation: landing page + JSON front door)', () => {
  it('returns the landing page (200 text/html) by default, with pricing, OpenAPI and Bazaar links', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/' });
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['content-type'])).toBe('text/html; charset=utf-8');
      const html = res.payload;
      expect(html).toContain('$0.001');
      expect(html).toContain('$0.01');
      expect(html).toContain('/openapi.json');
      expect(html).toContain('Bazaar');
      expect(html).toContain('x402');
      expect(html).toContain('<link rel="icon" href="/icon.png">');
      expect(html).toContain('GET /v1/extract/preview');
      expect(html).toContain('PAYMENT-REQUIRED');
      expect(html).toContain('eip155:84532');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('returns the pre-existing JSON front-door payload, deep-equal, for Accept: application/json', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/', headers: { accept: 'application/json' } });
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['content-type'])).toContain('application/json');
      // Snapshot of the pre-negotiation front-door shape (captured from the
      // running handler before the change); the payload must stay intact.
      expect(res.json()).toEqual({
        service: 'webcap',
        tagline:
          'Capture any URL as a screenshot, or extract its structured content + clean document-order markdown — paid per-request in USDC over x402 (HTTP 402).',
        endpoints: {
          free: [
            { path: 'GET /v1/extract/preview?url=...', note: 'bounded structured preview (rate-limited)' },
            { path: 'GET /v1/og?url=...', note: 'OG metadata' },
            { path: 'GET /v1/health', note: 'liveness + chain' },
          ],
          paid: [
            { path: 'POST /v1/x402/capture', usdc: 0.001, note: 'PNG/JPEG/PDF screenshot + free OG' },
            { path: 'POST /v1/x402/extract', usdc: 0.01, note: 'structured JSON; batch up to 10 URLs for one payment' },
          ],
        },
        catalog: 'GET /v1/x402/service — full agent-discoverable descriptor + the exact x402 payment flow',
        agentGuide: 'AGENT.md — how an AI agent discovers + pays (gasless EIP-3009, no ETH)',
        payment: 'x402 disabled (WEBCAP_CHAIN=local)',
      });
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('serves HTML when the client accepts both JSON and HTML', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/', headers: { accept: 'application/json, text/html' } });
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['content-type'])).toBe('text/html; charset=utf-8');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('serves HTML for wildcard Accept (curl/browser default)', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/', headers: { accept: '*/*' } });
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['content-type'])).toBe('text/html; charset=utf-8');
    } finally {
      await closeApiFixture(fx);
    }
  });
});
