import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CaptureError } from '../../src/capture/errors.js';
import * as errorsModule from '../../src/capture/errors.js';
import * as videoModule from '../../src/capture/video.js';
import { captureVideo, type ScrollStep, type VideoContext, type VideoContextOptions } from '../../src/capture/video.js';

/**
 * RED suite for video concurrency semaphore (V-S2b).
 *
 * 1. Overload rejects: with VIDEO_MAX_CONCURRENT=N slots held, the N+1th
 *    concurrent captureVideo rejects with a 429 video_busy error (status 429,
 *    code video_busy) — DISTINCT from the 502 video_failed mapping, so the
 *    route can answer 429 (back off) instead of 502 (broken page).
 * 2. No leak on success: after a capture resolves, its permit is released —
 *    a follow-up capture under a limit of 1 succeeds.
 * 3. No leak on failure: after a capture rejects (browser/goto failure), its
 *    permit is released — a follow-up capture under a limit of 1 succeeds.
 * 4. Default + env: the default limit is 2; VIDEO_MAX_CONCURRENT overrides it
 *    (invalid/empty falls back to the default, fail-open).
 *
 * New symbols are reached through namespace casts (V-S1 RED pattern) so this
 * file stays tsc-clean before the GREEN change lands; every 429 assertion
 * FAILS against the current src/capture/video.ts (no semaphore) at runtime.
 */

type VideoModuleWithSemaphore = typeof videoModule & {
  readonly VIDEO_MAX_CONCURRENT_DEFAULT?: unknown;
  readonly resolveVideoMaxConcurrent?: (raw?: string | undefined) => unknown;
};

type ErrorsModuleWithBusy = typeof errorsModule & {
  readonly VideoBusyError?: new (message: string) => Error & { readonly status?: unknown; readonly code?: unknown };
};

const sem = videoModule as unknown as VideoModuleWithSemaphore;
const errs = errorsModule as unknown as ErrorsModuleWithBusy;

function statusOf(err: unknown): unknown {
  return (err as { readonly status?: unknown }).status;
}

function codeOf(err: unknown): unknown {
  return (err as { readonly code?: unknown }).code;
}

function makeGate(): { readonly wait: () => Promise<void>; readonly open: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait: () => gate, open: () => release() };
}

async function stageVideoFile(tag: string): Promise<{ readonly dir: string; readonly videoPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), `video-concurrency-red-${tag}-`));
  const videoPath = join(dir, 'video.webm');
  await writeFile(videoPath, Buffer.from([1, 2, 3]));
  return { dir, videoPath };
}

interface GateFakes {
  readonly newContext: (opts: VideoContextOptions) => Promise<VideoContext>;
  readonly entered: () => number;
}

/** Fakes whose goto blocks on `gate` (holds a semaphore slot) then serves a real staged file. */
function makeGateFakes(videoPath: string, gate: { readonly wait: () => Promise<void> }): GateFakes {
  let entered = 0;
  const newContext = async (_opts: VideoContextOptions): Promise<VideoContext> => ({
    newPage: async () => ({
      goto: async (): Promise<void> => {
        entered += 1;
        await gate.wait();
      },
      evaluate: async (): Promise<void> => {},
      waitForTimeout: async (): Promise<void> => {},
      video: (): { readonly path: () => Promise<string> } | null => ({ path: async () => videoPath }),
      close: async (): Promise<void> => {},
    }),
    close: async (): Promise<void> => {},
  });
  return { newContext, entered: () => entered };
}

/** Immediate fakes that serve a staged file (no blocking). */
function makeImmediateFakes(videoPath: string): {
  readonly newContext: (opts: VideoContextOptions) => Promise<VideoContext>;
} {
  const newContext = async (_opts: VideoContextOptions): Promise<VideoContext> => ({
    newPage: async () => ({
      goto: async (): Promise<void> => {},
      evaluate: async (_fn: (step: ScrollStep) => void, _step: ScrollStep): Promise<void> => {},
      waitForTimeout: async (_ms: number): Promise<void> => {},
      video: (): { readonly path: () => Promise<string> } | null => ({ path: async () => videoPath }),
      close: async (): Promise<void> => {},
    }),
    close: async (): Promise<void> => {},
  });
  return { newContext };
}

/** Fakes whose goto always throws (capture failure path). */
function makeFailingFakes(): {
  readonly newContext: (opts: VideoContextOptions) => Promise<VideoContext>;
} {
  const newContext = async (_opts: VideoContextOptions): Promise<VideoContext> => ({
    newPage: async () => ({
      goto: async (): Promise<void> => {
        throw new Error('boom: browser gone');
      },
      evaluate: async (): Promise<void> => {},
      waitForTimeout: async (): Promise<void> => {},
      video: (): { readonly path: () => Promise<string> } | null => null,
      close: async (): Promise<void> => {},
    }),
    close: async (): Promise<void> => {},
  });
  return { newContext };
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for gate fakes to enter goto');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

type Settlement =
  | { readonly settled: 'resolved' }
  | { readonly settled: 'rejected'; readonly err: unknown }
  | { readonly settled: 'timeout' };

/**
 * Settles a capture promise with a backstop: without the semaphore the
 * overload capture blocks on the gate alongside the holders (deadlock), so
 * RED must report 'timeout' in seconds instead of hanging until the 60s
 * vitest timeout. GREEN rejects with 429 immediately, well under the backstop.
 */
async function settleCapture(promise: Promise<unknown>, timeoutMs: number): Promise<Settlement> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race<Settlement>([
      promise.then(
        (): Settlement => ({ settled: 'resolved' }),
        (err: unknown): Settlement => ({ settled: 'rejected', err }),
      ),
      new Promise<Settlement>((resolve) => {
        timer = setTimeout(() => resolve({ settled: 'timeout' }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const PREV_ENV = process.env.VIDEO_MAX_CONCURRENT;

beforeEach(() => {
  delete process.env.VIDEO_MAX_CONCURRENT;
});

afterEach(() => {
  if (PREV_ENV === undefined) delete process.env.VIDEO_MAX_CONCURRENT;
  else process.env.VIDEO_MAX_CONCURRENT = PREV_ENV;
});

describe('video V-S2b default limit + env override (RED)', () => {
  it('exposes a default limit of 2', () => {
    // RED: VIDEO_MAX_CONCURRENT_DEFAULT does not exist yet (undefined !== 2).
    expect(sem.VIDEO_MAX_CONCURRENT_DEFAULT).toBe(2);
  });

  it('resolveVideoMaxConcurrent honors VIDEO_MAX_CONCURRENT, fail-open on junk', () => {
    // RED: resolveVideoMaxConcurrent does not exist yet.
    expect(typeof sem.resolveVideoMaxConcurrent).toBe('function');
    if (sem.resolveVideoMaxConcurrent !== undefined) {
      expect(sem.resolveVideoMaxConcurrent(undefined)).toBe(2);
      expect(sem.resolveVideoMaxConcurrent('3')).toBe(3);
      expect(sem.resolveVideoMaxConcurrent('')).toBe(2);
      expect(sem.resolveVideoMaxConcurrent('junk')).toBe(2);
    }
  });
});

describe('video V-S2b overload rejects 429 video_busy, distinct from 502 (RED)', () => {
  it('N+1 concurrent captures reject with status 429 / code video_busy', async () => {
    process.env.VIDEO_MAX_CONCURRENT = '2';
    const { dir, videoPath } = await stageVideoFile('overload');
    const gate = makeGate();
    try {
      const fakes = makeGateFakes(videoPath, gate);
      const holders = [
        captureVideo({ url: 'https://example.com/a', format: 'mp4', durationMs: 300 }, { newContext: fakes.newContext }),
        captureVideo({ url: 'https://example.com/b', format: 'mp4', durationMs: 300 }, { newContext: fakes.newContext }),
      ];
      await waitFor(() => fakes.entered() === 2, 5_000);
      const outcome = await settleCapture(
        captureVideo(
          { url: 'https://example.com/c', format: 'mp4', durationMs: 300 },
          { newContext: fakes.newContext },
        ),
        5_000,
      );
      gate.open();
      await Promise.all(holders);
      // RED: no semaphore exists, so the 3rd capture blocks on the gate
      // alongside the holders -> 'timeout', not 'rejected'.
      expect(outcome.settled).toBe('rejected');
      if (outcome.settled === 'rejected') {
        expect(statusOf(outcome.err)).toBe(429);
        expect(codeOf(outcome.err)).toBe('video_busy');
        expect(String((outcome.err as Error).message)).toMatch(/busy|concurr|slot|429/i);
        if (errs.VideoBusyError !== undefined) expect(outcome.err).toBeInstanceOf(errs.VideoBusyError);
      }
    } finally {
      gate.open();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('the overload error is not the 502 video_failed path', async () => {
    process.env.VIDEO_MAX_CONCURRENT = '1';
    const { dir, videoPath } = await stageVideoFile('distinct');
    const gate = makeGate();
    try {
      const fakes = makeGateFakes(videoPath, gate);
      const holder = captureVideo(
        { url: 'https://example.com/a', format: 'mp4', durationMs: 300 },
        { newContext: fakes.newContext },
      );
      await waitFor(() => fakes.entered() === 1, 5_000);
      const outcome = await settleCapture(
        captureVideo(
          { url: 'https://example.com/b', format: 'mp4', durationMs: 300 },
          { newContext: fakes.newContext },
        ),
        5_000,
      );
      gate.open();
      await holder;
      // RED: blocks on the gate -> 'timeout'; GREEN: rejects 429, never 502.
      expect(outcome.settled).toBe('rejected');
      if (outcome.settled === 'rejected') {
        expect(statusOf(outcome.err)).not.toBe(502);
        expect(codeOf(outcome.err)).not.toBe('video_failed');
        expect(outcome.err).not.toBeInstanceOf(CaptureError);
      }
    } finally {
      gate.open();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('video V-S2b semaphore releases permits, no leak (RED)', () => {
  it('releases on success: a follow-up capture under limit 1 succeeds', async () => {
    process.env.VIDEO_MAX_CONCURRENT = '1';
    const { dir, videoPath } = await stageVideoFile('release-ok');
    try {
      const fakes = makeImmediateFakes(videoPath);
      const first = await captureVideo(
        { url: 'https://example.com/a', format: 'mp4', durationMs: 300 },
        { newContext: fakes.newContext },
      );
      expect(first.bytes).toBe(3);
      const second = await captureVideo(
        { url: 'https://example.com/b', format: 'mp4', durationMs: 300 },
        { newContext: fakes.newContext },
      );
      expect(second.bytes).toBe(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('releases on failure: a capture after a rejected one under limit 1 succeeds', async () => {
    process.env.VIDEO_MAX_CONCURRENT = '1';
    const { dir, videoPath } = await stageVideoFile('release-err');
    try {
      const failing = makeFailingFakes();
      await expect(
        captureVideo({ url: 'https://example.com/a', format: 'mp4', durationMs: 300 }, { newContext: failing.newContext }),
      ).rejects.toBeInstanceOf(CaptureError);
      const good = makeImmediateFakes(videoPath);
      const second = await captureVideo(
        { url: 'https://example.com/b', format: 'mp4', durationMs: 300 },
        { newContext: good.newContext },
      );
      expect(second.bytes).toBe(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
