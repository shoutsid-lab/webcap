import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CaptureError } from '../../src/capture/errors.js';
import type { CaptureTimeouts } from '../../src/capture/pipeline.js';
import {
  captureVideo,
  type ScrollStep,
  type VideoContext,
  type VideoContextOptions,
} from '../../src/capture/video.js';
import {
  DEFAULT_X402_AUDIT_PRICE_USDC_UNITS,
  DEFAULT_X402_EXTRACT_PRICE_USDC_UNITS,
  DEFAULT_X402_PRICE_USDC_UNITS,
  DEFAULT_X402_VIDEO_PRICE_USDC_UNITS,
  DEFAULT_CAPTURE_TIMEOUT_MS,
} from '../../src/config.js';
import { parseVideoRequest } from '../../src/server/video-parse.js';
import { HttpError } from '../../src/util/errors.js';

/**
 * RED suite for video timeout wiring (V-S1) + regression guard.
 *
 * V-S1 expects captureVideo to follow the pipeline.ts pattern:
 *   captureVideo(req, deps?, timeouts?: CaptureTimeouts & { overallMs?: number })
 * where page.goto uses resolveTimeout(req/timeouts) instead of the hardcoded
 * DEFAULT_CAPTURE_TIMEOUT_MS, and an exhausted overall budget aborts the
 * scroll choreography with a DISTINCT timeout error (message matches
 * /overall|budget/i, instanceof CaptureError) rather than a generic failure.
 *
 * These tests FAIL against the current src/capture/video.ts (hardcoded 30s
 * goto, no overall budget) and must go GREEN via src/ changes only.
 */

type VideoDeps = NonNullable<Parameters<typeof captureVideo>[1]>;

type VideoTimeouts = CaptureTimeouts & { readonly overallMs?: number };

type CaptureVideoWithTimeouts = (
  req: Parameters<typeof captureVideo>[0],
  deps?: VideoDeps,
  timeouts?: VideoTimeouts,
) => ReturnType<typeof captureVideo>;

const captureVideoWithTimeouts = captureVideo as unknown as CaptureVideoWithTimeouts;

interface TimeoutFakes {
  readonly newContext: (opts: VideoContextOptions) => Promise<VideoContext>;
  readonly gotoTimeouts: number[];
}

function makeTimeoutFakes(videoPath: string, wait: 'immediate' | 'real'): TimeoutFakes {
  const gotoTimeouts: number[] = [];
  const newContext = async (_opts: VideoContextOptions): Promise<VideoContext> => ({
    newPage: async () => ({
      goto: async (_url: string, options?: { readonly timeout?: number }): Promise<void> => {
        gotoTimeouts.push(options?.timeout ?? -1);
      },
      evaluate: async (_fn: (step: ScrollStep) => void, _step: ScrollStep): Promise<void> => {},
      waitForTimeout:
        wait === 'real'
          ? async (ms: number): Promise<void> => {
              await new Promise((resolve) => setTimeout(resolve, ms));
            }
          : async (_ms: number): Promise<void> => {},
      video: (): { readonly path: () => Promise<string> } | null => ({ path: async () => videoPath }),
      close: async (): Promise<void> => {},
    }),
    close: async (): Promise<void> => {},
  });
  return { newContext, gotoTimeouts };
}

async function stageVideoFile(tag: string): Promise<{ readonly dir: string; readonly videoPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), `video-timeout-red-${tag}-`));
  const videoPath = join(dir, 'video.webm');
  await writeFile(videoPath, Buffer.from([1, 2, 3]));
  return { dir, videoPath };
}

describe('video V-S1 goto honors resolveTimeout/CaptureTimeouts (RED)', () => {
  it('uses the caller timeouts default instead of the hardcoded 30s goto', async () => {
    // Documents the current hardcode: the goto below must NOT see 30_000
    // once timeouts are wired.
    expect(DEFAULT_CAPTURE_TIMEOUT_MS).toBe(30_000);
    const { dir, videoPath } = await stageVideoFile('goto-default');
    try {
      const fakes = makeTimeoutFakes(videoPath, 'immediate');
      await captureVideoWithTimeouts(
        { url: 'https://example.com/', format: 'mp4', durationMs: 300 },
        { newContext: fakes.newContext },
        { defaultMs: 1234, capMs: 60_000 },
      );
      expect(fakes.gotoTimeouts).toHaveLength(1);
      // resolveTimeout parity: requested default 1234 under cap 60_000 -> 1234.
      // RED: video.ts hardcodes DEFAULT_CAPTURE_TIMEOUT_MS (30_000).
      expect(fakes.gotoTimeouts[0]).toBe(1234);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('caps the goto timeout at capMs (pipeline resolveTimeout parity)', async () => {
    const { dir, videoPath } = await stageVideoFile('goto-cap');
    try {
      const fakes = makeTimeoutFakes(videoPath, 'immediate');
      await captureVideoWithTimeouts(
        { url: 'https://example.com/', format: 'mp4', durationMs: 300 },
        { newContext: fakes.newContext },
        { defaultMs: 99_999, capMs: 7_000 },
      );
      expect(fakes.gotoTimeouts).toHaveLength(1);
      // RED: hardcoded 30_000 is neither the 99_999 default nor the 7_000 cap.
      expect(fakes.gotoTimeouts[0]).toBe(7_000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('video V-S1 overall budget aborts distinctly (RED)', () => {
  it('rejects with a distinct overall-budget CaptureError instead of completing', async () => {
    const { dir, videoPath } = await stageVideoFile('overall');
    try {
      const fakes = makeTimeoutFakes(videoPath, 'real');
      const outcome = await captureVideoWithTimeouts(
        { url: 'https://example.com/', format: 'mp4', durationMs: 1200 },
        { newContext: fakes.newContext },
        { defaultMs: 30_000, capMs: 60_000, overallMs: 50 },
      ).then(
        () => ({ settled: 'resolved' as const }),
        (err: unknown) => ({ settled: 'rejected' as const, err }),
      );
      // RED: no overall budget exists, so the 1200ms choreography completes.
      expect(outcome.settled).toBe('rejected');
      if (outcome.settled === 'rejected') {
        expect(outcome.err).toBeInstanceOf(CaptureError);
        expect(String((outcome.err as Error).message)).toMatch(/overall|budget/i);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('video timeout wiring regression guard', () => {
  it('keeps the 402 price ladder: capture 1000 / audit+map-lite 2000 / video 5000 / extract 10000', () => {
    expect(DEFAULT_X402_PRICE_USDC_UNITS).toBe(1_000);
    expect(DEFAULT_X402_AUDIT_PRICE_USDC_UNITS).toBe(2_000);
    expect(DEFAULT_X402_VIDEO_PRICE_USDC_UNITS).toBe(5_000);
    expect(DEFAULT_X402_EXTRACT_PRICE_USDC_UNITS).toBe(10_000);
    expect(DEFAULT_X402_AUDIT_PRICE_USDC_UNITS).toBeLessThan(DEFAULT_X402_VIDEO_PRICE_USDC_UNITS);
    expect(DEFAULT_X402_VIDEO_PRICE_USDC_UNITS).toBeLessThan(DEFAULT_X402_EXTRACT_PRICE_USDC_UNITS);
    expect(DEFAULT_X402_VIDEO_PRICE_USDC_UNITS).toBe(5 * DEFAULT_X402_PRICE_USDC_UNITS);
  });

  it('leaves scroll-easing parse untouched (linear default, ease-in-out accepted, others 422)', () => {
    expect(parseVideoRequest({ url: 'https://example.com/' }, undefined).scrollEasing).toBe('linear');
    expect(
      parseVideoRequest({ url: 'https://example.com/', scrollEasing: 'ease-in-out' }, undefined).scrollEasing,
    ).toBe('ease-in-out');
    try {
      parseVideoRequest({ url: 'https://example.com/', scrollEasing: 'bounce' }, undefined);
      expect.unreachable('expected parseVideoRequest to throw for scrollEasing=bounce');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      if (err instanceof HttpError) expect(err.status).toBe(422);
    }
  });
});
