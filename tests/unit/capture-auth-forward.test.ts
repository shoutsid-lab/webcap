import { describe, expect, it, vi } from 'vitest';
import { capture } from '../../src/capture/pipeline.js';
import type { ContextViewportOptions } from '../../src/capture/browser.js';

interface FakePage {
  readonly gotoCalls: string[];
  readonly clicked: string[];
  readonly filled: Array<{ selector: string; text: string }>;
  readonly waitedMs: number[];
}

interface FakeContext {
  readonly opts: ContextViewportOptions | undefined;
  readonly page: FakePage;
  readonly addedCookies: unknown[];
}

const contexts: FakeContext[] = [];

vi.mock('../../src/capture/browser.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/capture/browser.js')>();
  return {
    ...actual,
    newContext: vi.fn(async (opts?: ContextViewportOptions) => {
      const ctx: FakeContext = { opts, page: { gotoCalls: [], clicked: [], filled: [], waitedMs: [] }, addedCookies: [] };
      contexts.push(ctx);
      const context = {
        newPage: async () => ({
          goto: async (url: string) => {
            ctx.page.gotoCalls.push(url);
          },
          click: async (selector: string) => {
            ctx.page.clicked.push(selector);
          },
          fill: async (selector: string, text: string) => {
            ctx.page.filled.push({ selector, text });
          },
          waitForTimeout: async (ms: number) => {
            ctx.page.waitedMs.push(ms);
          },
          waitForSelector: async () => undefined,
          screenshot: async () => Buffer.from('shot'),
          close: async () => undefined,
        }),
        addCookies: async (cookies: unknown) => {
          ctx.addedCookies.push(cookies);
        },
        addInitScript: async () => undefined,
        close: async () => undefined,
      };
      // Mirror the real newContext contract: cookies apply via addCookies.
      if (opts?.cookies !== undefined && opts.cookies.length > 0) {
        await context.addCookies(opts.cookies.map((cookie) => ({ ...cookie })));
      }
      return context;
    }),
  };
});

describe('capture pipeline macro-auth forwarding (RED)', () => {
  it('forwards extraHTTPHeaders + cookies to the browser context', async () => {
    contexts.length = 0;
    await capture({
      url: 'https://example.com/page',
      options: {
        extraHTTPHeaders: { authorization: 'Bearer s3cr3t' },
        cookies: [{ name: 'sid', value: 'abc' }],
      },
    });
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.opts).toMatchObject({
      extraHTTPHeaders: { authorization: 'Bearer s3cr3t' },
      cookies: [{ name: 'sid', value: 'abc' }],
    });
    expect(contexts[0]?.addedCookies).toEqual([[{ name: 'sid', value: 'abc' }]]);
  });

  it('executes macro steps in order, including goto', async () => {
    contexts.length = 0;
    await capture({
      url: 'https://example.com/page',
      options: {
        actions: [
          { type: 'goto', url: 'https://example.com/login' },
          { type: 'type', selector: '#user', text: 'u' },
          { type: 'click', selector: '#go' },
          { type: 'wait', timeoutMs: 500 },
        ],
      },
    });
    expect(contexts).toHaveLength(1);
    const page = contexts[0]?.page;
    expect(page?.gotoCalls).toEqual(['https://example.com/page', 'https://example.com/login']);
    expect(page?.filled).toEqual([{ selector: '#user', text: 'u' }]);
    expect(page?.clicked).toEqual(['#go']);
    expect(page?.waitedMs).toEqual([500]);
  });
});
