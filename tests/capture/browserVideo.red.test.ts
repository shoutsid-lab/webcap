import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { chromium } from 'playwright-core';
import { closeBrowser, newContext, type ContextViewportOptions } from '../../src/capture/browser.js';

vi.mock('playwright-core', () => ({
  chromium: {
    launch: vi.fn(async () => ({
      close: async () => undefined,
      newContext: vi.fn(async (opts: unknown) => ({
        addInitScript: async () => undefined,
        addCookies: vi.fn(async () => undefined),
        close: async () => undefined,
        captured: opts,
      })),
    })),
  },
}));

/** recordVideo as the video pipeline passes it (see VideoContextOptions in src/capture/video.ts). */
interface RecordVideoOptions extends ContextViewportOptions {
  readonly recordVideo: { readonly dir: string };
}

async function lastBrowser(): Promise<{ newContext: Mock }> {
  const launch = chromium.launch as unknown as Mock;
  const result = launch.mock.results[launch.mock.results.length - 1];
  if (result?.type !== 'return') throw new Error('expected chromium.launch to have returned');
  return result.value as { newContext: Mock };
}

async function lastContextOptions(): Promise<Record<string, unknown>> {
  const browser = await lastBrowser();
  const calls = browser.newContext.mock.calls;
  return (calls[calls.length - 1]?.[0] ?? {}) as Record<string, unknown>;
}

afterEach(async () => {
  await closeBrowser();
  vi.clearAllMocks();
});

describe('browser newContext forwards recordVideo (RED)', () => {
  it('forwards recordVideo to the Playwright context options', async () => {
    const dir = join(tmpdir(), 'webcap-video-red');
    const opts: RecordVideoOptions = { recordVideo: { dir } };
    await newContext(opts);
    expect(await lastContextOptions()).toMatchObject({ recordVideo: { dir } });
  });

  it('forwards recordVideo alongside viewport options (no Object.assign-only drop)', async () => {
    const dir = join(tmpdir(), 'webcap-video-red');
    const opts: RecordVideoOptions = {
      viewport: { width: 1280, height: 800 },
      recordVideo: { dir },
    };
    await newContext(opts);
    expect(await lastContextOptions()).toMatchObject({
      viewport: { width: 1280, height: 800 },
      recordVideo: { dir },
    });
  });

  it('has closed TODO(video-wire): the video seam no longer carries recordVideo via Object.assign', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const videoSrc = readFileSync(join(here, '../../src/capture/video.ts'), 'utf8');
    expect(videoSrc).not.toContain('TODO(video-wire)');
  });

  it('omits recordVideo from the Playwright options when unset', async () => {
    await newContext({ viewport: { width: 1280, height: 800 } });
    expect(await lastContextOptions()).not.toHaveProperty('recordVideo');
  });
});
