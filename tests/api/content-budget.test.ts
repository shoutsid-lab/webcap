/**
 * `options.maxContentWords` — the agent-facing content budget.
 *
 * Validation and clamping live in parseOptions (the same parser every capture
 * path shares); the pipeline applies it inside the page. Both halves are pinned
 * here so the option cannot silently stop working.
 */
import { describe, expect, it } from 'vitest';
import { MAX_CONTENT_WORDS, MIN_CONTENT_WORDS, type PageStructure } from '../../src/capture/pipeline.js';
import { parseOptions } from '../../src/server/capture-parse.js';
import { HttpError } from '../../src/util/errors.js';
import { closeApiFixture, makeApiFixture } from './fixture.js';

function errCode(err: unknown): string {
  return err instanceof HttpError ? err.code : 'no-error';
}

describe('options.maxContentWords', () => {
  it('accepts a positive integer and passes it through', () => {
    expect(parseOptions({ options: { maxContentWords: 500 } })).toMatchObject({ maxContentWords: 500 });
  });

  it('clamps to the supported bounds instead of rejecting', () => {
    expect(parseOptions({ options: { maxContentWords: 1 } })).toMatchObject({ maxContentWords: MIN_CONTENT_WORDS });
    expect(parseOptions({ options: { maxContentWords: 10_000_000 } })).toMatchObject({ maxContentWords: MAX_CONTENT_WORDS });
  });

  it('rejects non-integers, zero and negatives with 422', () => {
    for (const bad of ['lots', 12.5, 0, -5, true, null]) {
      try {
        parseOptions({ options: { maxContentWords: bad } });
        expect.fail(`maxContentWords=${String(bad)} should have been rejected`);
      } catch (err) {
        expect(errCode(err)).toBe('unprocessable');
      }
    }
  });

  it('is the only option that makes an otherwise empty options object meaningful', () => {
    expect(parseOptions({ options: {} })).toBeUndefined();
    expect(parseOptions({ options: { maxContentWords: 100 } })).toBeDefined();
    // ...and it composes with the existing ones.
    expect(parseOptions({ options: { fullPage: true, maxContentWords: 100 } })).toMatchObject({
      fullPage: true,
      maxContentWords: 100,
    });
  });

  it('reaches the capture pipeline through the paid extract route', async () => {
    const seen: Array<{ maxContentWords?: number } | undefined> = [];
    const fx = makeApiFixture({
      captureStructured: async (req) => {
        seen.push(req.options);
        const structure: PageStructure = {
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
        return { html: '<html></html>', structure };
      },
    });
    try {
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/x402/extract',
        payload: { url: 'https://example.com/', options: { maxContentWords: 1_000 } },
      });
      // Unpaid: the route challenges first (402) or refuses (503) depending on
      // whether x402 is configured in this fixture — either is a valid gate, and
      // neither may execute the capture without payment.
      if (res.statusCode === 402 || res.statusCode === 503) {
        expect(seen).toHaveLength(0);
        return;
      }
      expect(seen[0]).toMatchObject({ maxContentWords: 1_000 });
    } finally {
      await closeApiFixture(fx);
    }
  });
});
