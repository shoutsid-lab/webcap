import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CaptureError } from '../../src/capture/errors.js';
import {
  VIDEO_STAGING_MAX_AGE_MS,
  VIDEO_STAGING_MAX_BYTES,
  VIDEO_STAGING_PREFIX,
  captureVideo,
  reapStaleVideoStaging,
  type ScrollStep,
  type VideoContext,
  type VideoContextOptions,
} from '../../src/capture/video.js';

/**
 * RED suite for video staging hardening (V-S2a).
 *
 * 1. Pre-write size guard: a staged recording larger than
 *    VIDEO_STAGING_MAX_BYTES must reject with CaptureError (matches
 *    /oversize|too large|staging/i) instead of returning a giant buffer
 *    (tmp-fill mitigation).
 * 2. Orphan reaper: reapStaleVideoStaging() removes stale `webcap-video-*`
 *    dirs under the tmp root (mtime older than VIDEO_STAGING_MAX_AGE_MS),
 *    keeps fresh + non-matching entries, and returns the reaped count.
 * 3. Boot never throws: the sweep is best-effort — missing root, file root,
 *    or unloadable entries resolve (to 0) instead of rejecting.
 *
 * These tests FAIL against the current src/capture/video.ts (no guard, no
 * reaper) and must go GREEN via src/ changes only.
 */

function makeStagingFakes(videoPath: string | null): {
  readonly newContext: (opts: VideoContextOptions) => Promise<VideoContext>;
} {
  const newContext = async (_opts: VideoContextOptions): Promise<VideoContext> => ({
    newPage: async () => ({
      goto: async (): Promise<void> => {},
      evaluate: async (_fn: (step: ScrollStep) => void, _step: ScrollStep): Promise<void> => {},
      waitForTimeout: async (_ms: number): Promise<void> => {},
      video: (): { readonly path: () => Promise<string> } | null =>
        videoPath === null ? null : { path: async () => videoPath },
      close: async (): Promise<void> => {},
    }),
    close: async (): Promise<void> => {},
  });
  return { newContext };
}

describe('video V-S2a staging size guard (RED)', () => {
  it('exposes a positive staging byte cap under the webcap-video- prefix', () => {
    expect(VIDEO_STAGING_PREFIX).toBe('webcap-video-');
    expect(VIDEO_STAGING_MAX_BYTES).toBeGreaterThan(0);
    expect(VIDEO_STAGING_MAX_AGE_MS).toBeGreaterThan(0);
  });

  it('rejects an oversize staged recording instead of returning it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'video-staging-red-'));
    const videoPath = join(dir, 'video.webm');
    await writeFile(videoPath, Buffer.alloc(VIDEO_STAGING_MAX_BYTES + 1, 0));
    try {
      const fakes = makeStagingFakes(videoPath);
      const outcome = await captureVideo(
        { url: 'https://example.com/', format: 'mp4', durationMs: 300 },
        { newContext: fakes.newContext },
      ).then(
        () => ({ settled: 'resolved' as const }),
        (err: unknown) => ({ settled: 'rejected' as const, err }),
      );
      // RED: no guard exists, so the oversize buffer resolves.
      expect(outcome.settled).toBe('rejected');
      if (outcome.settled === 'rejected') {
        expect(outcome.err).toBeInstanceOf(CaptureError);
        expect(String((outcome.err as Error).message)).toMatch(/oversize|too large|staging/i);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('video V-S2a orphan reaper (RED)', () => {
  it('removes stale webcap-video-* dirs and keeps fresh + non-matching entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-reaper-red-'));
    try {
      const stale = join(root, `${VIDEO_STAGING_PREFIX}stale`);
      const fresh = join(root, `${VIDEO_STAGING_PREFIX}fresh`);
      const other = join(root, 'other-dir');
      await mkdir(stale, { recursive: true });
      await mkdir(fresh, { recursive: true });
      await mkdir(other, { recursive: true });
      const ancient = new Date(Date.now() - VIDEO_STAGING_MAX_AGE_MS - 60_000);
      await utimes(stale, ancient, ancient);
      await utimes(other, ancient, ancient);

      // RED: reapStaleVideoStaging does not exist yet.
      const reaped = await reapStaleVideoStaging(root, VIDEO_STAGING_MAX_AGE_MS);
      expect(reaped).toBeGreaterThanOrEqual(1);
      expect(existsSync(stale)).toBe(false);
      expect(existsSync(fresh)).toBe(true);
      expect(existsSync(other)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('never throws on a missing or non-directory root (boot-safe)', async () => {
    const missing = join(tmpdir(), `video-reaper-red-missing-${Date.now()}`);
    await expect(reapStaleVideoStaging(missing, VIDEO_STAGING_MAX_AGE_MS)).resolves.toBe(0);
    const fileRoot = join(tmpdir(), `video-reaper-red-file-${Date.now()}.txt`);
    await writeFile(fileRoot, 'not a dir');
    try {
      await expect(reapStaleVideoStaging(fileRoot, VIDEO_STAGING_MAX_AGE_MS)).resolves.toBe(0);
    } finally {
      await rm(fileRoot, { force: true });
    }
  });
});
