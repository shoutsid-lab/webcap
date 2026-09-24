/**
 * Ad-hoc session auth (`options.auth`) + `options.stealth` reach the capture
 * pipeline on the credits rail.
 *
 * parseOptions maps `auth` onto the pipeline's context-auth shape and the
 * pipeline threads it into the browser context (cookies via addCookies,
 * headers via extraHTTPHeaders — covered at the context layer by
 * browser-auth.test.ts). This pins the route → parse → pipeline handoff so
 * the option cannot silently stop working.
 */
import { describe, expect, it } from 'vitest';
import type { CaptureRequest, PageStructure } from '../../src/capture/pipeline.js';
import { closeApiFixture, makeApiFixture } from './fixture.js';

const STUB_STRUCTURE: PageStructure = {
  title: 'Stub',
  description: '',
  headings: [],
  paragraphs: [],
  links: [],
  images: [],
  wordCount: 0,
  markdown: '',
  content: { source: 'body', words: 0, truncated: false },
};

describe('options.auth + options.stealth on POST /v1/extract', () => {
  it('forwards session auth and stealth to the capture pipeline', async () => {
    const seen: Array<CaptureRequest['options']> = [];
    const fx = makeApiFixture({
      captureStructured: async (req) => {
        seen.push(req.options);
        return { html: '<html></html>', structure: STUB_STRUCTURE };
      },
    });
    try {
      fx.credits.grantCredits(fx.accountId, 5, 'test_seed');
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/extract',
        payload: {
          url: 'https://example.com/',
          options: {
            auth: {
              headers: { authorization: 'Bearer s3cr3t' },
              cookies: [{ name: 'sid', value: 'abc', domain: 'example.com' }],
            },
            stealth: true,
          },
        },
        headers: { authorization: `Bearer ${fx.apiKey}` },
      });
      expect(res.statusCode).toBe(200);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({
        extraHTTPHeaders: { authorization: 'Bearer s3cr3t' },
        cookies: [{ name: 'sid', value: 'abc', domain: 'example.com' }],
        stealth: true,
      });
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('rejects a disallowed auth header with 422 and charges nothing', async () => {
    const seen: Array<CaptureRequest['options']> = [];
    const fx = makeApiFixture({
      captureStructured: async (req) => {
        seen.push(req.options);
        return { html: '<html></html>', structure: STUB_STRUCTURE };
      },
    });
    try {
      fx.credits.grantCredits(fx.accountId, 5, 'test_seed');
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/extract',
        payload: {
          url: 'https://example.com/',
          options: { auth: { headers: { 'x-evil': 'nope' } } },
        },
        headers: { authorization: `Bearer ${fx.apiKey}` },
      });
      expect(res.statusCode).toBe(422);
      expect(seen).toHaveLength(0);
      expect(fx.accounts.getBalance(fx.accountId)).toBe(5);
    } finally {
      await closeApiFixture(fx);
    }
  });
});
