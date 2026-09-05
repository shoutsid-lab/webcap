import { describe, expect, it } from 'vitest';
import { CaptureError } from '../../src/capture/errors.js';
import type { StructuredCapture } from '../../src/capture/pipeline.js';
import { closeApiFixture, makeApiFixture } from './fixture.js';

describe('GET /v1/extract/preview (free, rate-limited funnel)', () => {
  it('GET / returns the service map (front door)', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { service: string; endpoints: { paid: Array<{ path: string }> } };
      expect(body.service).toBe('webcap');
      expect(body.endpoints.paid.map((p) => p.path)).toEqual(['POST /v1/x402/capture', 'POST /v1/x402/extract']);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('returns a truncated structured preview (no payment, no auth)', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/v1/extract/preview?url=https://example.com/' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        url: string;
        preview: { title: string; wordCount: number; markdown: string };
        truncated: boolean;
        upgrade: { endpoint: string };
      };
      expect(body.url).toBe('https://example.com/');
      expect(body.preview.title).toBe('Stub Title');
      expect(body.preview.wordCount).toBe(4);
      expect(typeof body.preview.markdown).toBe('string');
      expect(body.truncated).toBe(true);
      expect(body.upgrade.endpoint).toBe('POST /v1/x402/extract');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('422 on a missing url', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/v1/extract/preview' });
      expect(res.statusCode).toBe(422);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('502 when the structured capture fails', async () => {
    const fx = makeApiFixture({
      captureStructured: async (): Promise<StructuredCapture> => {
        throw new CaptureError('boom');
      },
    });
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/v1/extract/preview?url=https://example.com/' });
      expect(res.statusCode).toBe(502);
      const envelope = res.json() as { error: { code: string } };
      expect(envelope.error.code).toBe('capture_failed');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('rate-limits per client (429 after the per-window budget is exhausted)', async () => {
    const fx = makeApiFixture();
    try {
      let last = 0;
      for (let i = 0; i < 15; i += 1) {
        const res = await fx.app.inject({ method: 'GET', url: '/v1/extract/preview?url=https://example.com/' });
        last = res.statusCode;
      }
      expect(last).toBe(429);
    } finally {
      await closeApiFixture(fx);
    }
  });
});
