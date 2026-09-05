import { describe, expect, it } from 'vitest';
import { closeApiFixture, makeApiFixture } from './fixture.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('GET /icon.png (service icon for bazaar discovery)', () => {
  it('serves a real PNG with the right content-type and cache headers', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/icon.png' });
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['content-type'])).toMatch(/^image\/png/);
      expect(String(res.headers['cache-control'])).toBe('public, max-age=86400');
      expect(Buffer.from(res.rawPayload.subarray(0, 8))).toEqual(PNG_SIGNATURE);
    } finally {
      await closeApiFixture(fx);
    }
  });
});
