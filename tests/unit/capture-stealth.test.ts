import { describe, expect, it } from 'vitest';
import { parseOptions } from '../../src/server/capture-parse.js';
import { extractPage } from '../../src/extract/service.js';
import type { CaptureRequest, StructuredCapture } from '../../src/capture/pipeline.js';
import { HttpError } from '../../src/util/errors.js';

function expectUnprocessable(body: unknown, fragment: string): void {
  try {
    parseOptions(body);
    expect.unreachable('expected parseOptions to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    if (err instanceof HttpError) {
      expect(err.status).toBe(422);
      expect(err.message).toContain(fragment);
    }
  }
}

describe('server/capture-parse stealth proxy option', () => {
  it.each([['auto'], ['stealth']])('passes through proxy %o unchanged', (proxy) => {
    expect(parseOptions({ options: { proxy } })).toEqual({ proxy });
  });

  it('passes through a proxy URL string unchanged', () => {
    expect(parseOptions({ options: { proxy: 'http://proxy.internal:8080' } })).toEqual({
      proxy: 'http://proxy.internal:8080',
    });
  });

  it.each([[42], [true], [null], [[]], [{}], [''], ['   '], ['ftp://proxy.internal:21'], ['not-a-url']])(
    'rejects proxy %o with 422',
    (proxy) => {
      expectUnprocessable({ options: { proxy } }, 'proxy');
    },
  );
});

describe('server/capture-parse stealth waitFor option', () => {
  it('passes through waitFor {selector} unchanged', () => {
    expect(parseOptions({ options: { waitFor: { selector: '#main' } } })).toEqual({
      waitFor: { selector: '#main' },
    });
  });

  it('passes through waitFor timeoutMs within the cap unchanged', () => {
    expect(parseOptions({ options: { waitFor: { selector: '#main', timeoutMs: 2000 } } })).toEqual({
      waitFor: { selector: '#main', timeoutMs: 2000 },
    });
  });

  it('caps waitFor timeoutMs above the cap down to the cap', () => {
    expect(parseOptions({ options: { waitFor: { selector: '#main', timeoutMs: 120_000 } } })).toEqual({
      waitFor: { selector: '#main', timeoutMs: 10_000 },
    });
  });

  it.each([[42], [true], [null], [[]], ['#main']])('rejects non-object waitFor %o with 422', (waitFor) => {
    expectUnprocessable({ options: { waitFor } }, 'waitFor');
  });

  it.each([[undefined], [''], ['   '], [42], [null], [[]]])('rejects waitFor selector %o with 422', (selector) => {
    expectUnprocessable({ options: { waitFor: { selector } } }, 'waitFor');
  });

  it.each([[0], [-1], [2.5], ['2000'], [null]])('rejects waitFor timeoutMs %o with 422', (timeoutMs) => {
    expectUnprocessable({ options: { waitFor: { selector: '#main', timeoutMs } } }, 'waitFor');
  });
});

describe('server/capture-parse stealth actions option', () => {
  it('passes through click/type/wait action shapes unchanged', () => {
    expect(
      parseOptions({
        options: {
          actions: [
            { type: 'click', selector: '#consent' },
            { type: 'type', selector: '#q', text: 'hello' },
            { type: 'wait', timeoutMs: 500 },
          ],
        },
      }),
    ).toEqual({
      actions: [
        { type: 'click', selector: '#consent' },
        { type: 'type', selector: '#q', text: 'hello' },
        { type: 'wait', timeoutMs: 500 },
      ],
    });
  });

  it('caps a wait-action timeoutMs above the cap down to the cap', () => {
    expect(parseOptions({ options: { actions: [{ type: 'wait', timeoutMs: 120_000 }] } })).toEqual({
      actions: [{ type: 'wait', timeoutMs: 10_000 }],
    });
  });

  it('rejects more than 5 actions with 422', () => {
    const actions = Array.from({ length: 6 }, () => ({ type: 'click', selector: '#x' }));
    expectUnprocessable({ options: { actions } }, 'actions');
  });

  it.each([[{}], ['click'], [null], [{ type: 'click' }]])('rejects actions %o with 422', (actions) => {
    expectUnprocessable({ options: { actions } }, 'actions');
  });

  it.each([[['hover']], [['scroll']], [[42]], [[null]], [['']]])(
    'rejects unknown action type %o with 422',
    ([type]) => {
      expectUnprocessable({ options: { actions: [{ type, selector: '#x' }] } }, 'actions');
    },
  );

  it('rejects a click action with a missing or blank selector with 422', () => {
    expectUnprocessable({ options: { actions: [{ type: 'click' }] } }, 'actions');
    expectUnprocessable({ options: { actions: [{ type: 'click', selector: '   ' }] } }, 'actions');
  });

  it('rejects a type action with missing text with 422', () => {
    expectUnprocessable({ options: { actions: [{ type: 'type', selector: '#q' }] } }, 'actions');
    expectUnprocessable({ options: { actions: [{ type: 'type', selector: '#q', text: '' }] } }, 'actions');
  });

  it('rejects a wait action with a missing or non-positive timeoutMs with 422', () => {
    expectUnprocessable({ options: { actions: [{ type: 'wait' }] } }, 'actions');
    expectUnprocessable({ options: { actions: [{ type: 'wait', timeoutMs: 0 }] } }, 'actions');
  });
});

describe('extract path forwards stealth capture options', () => {
  it('passes captureOptions through to captureStructured alongside includeHtml', async () => {
    const calls: CaptureRequest[] = [];
    const captureStructured = async (req: CaptureRequest): Promise<StructuredCapture> => {
      calls.push(req);
      return {
        html: '<html>page</html>',
        structure: {
          title: 't',
          description: '',
          headings: [],
          paragraphs: [],
          links: [],
          images: [],
          wordCount: 0,
          markdown: '',
        },
      };
    };
    await extractPage({
      url: 'https://example.com/',
      captureStructured,
      schema: undefined,
      model: { baseUrl: '', apiKey: '', model: '' },
      captureOptions: { proxy: 'stealth', waitFor: { selector: '#main' } },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options).toMatchObject({ proxy: 'stealth', waitFor: { selector: '#main' } });
  });
});

describe('server/capture-parse stealth combined options', () => {
  it('combines stealth fields with the existing viewport/mobile fields', () => {
    expect(
      parseOptions({
        options: {
          timeoutMs: 5000,
          fullPage: true,
          viewport: { width: 1280, height: 800 },
          proxy: 'stealth',
          waitFor: { selector: '#main', timeoutMs: 2000 },
          actions: [{ type: 'click', selector: '#consent' }],
        },
      }),
    ).toEqual({
      timeoutMs: 5000,
      fullPage: true,
      viewport: { width: 1280, height: 800 },
      proxy: 'stealth',
      waitFor: { selector: '#main', timeoutMs: 2000 },
      actions: [{ type: 'click', selector: '#consent' }],
    });
  });
});
