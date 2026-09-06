import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'playwright-core';
import { newContext as baseNewContext, type ContextViewportOptions } from './browser.js';
import { CaptureError } from './errors.js';
import type { CaptureTimeouts } from './pipeline.js';
import { DEFAULT_CAPTURE_TIMEOUT_CAP_MS, DEFAULT_CAPTURE_TIMEOUT_MS } from '../config.js';

export type VideoFormat = 'mp4' | 'webm';

export type VideoMime = 'video/mp4' | 'video/webm';

export type ScrollEasing = 'linear' | 'ease-in-out';

/** Hard ceiling for a scroll-capture recording (parse rejects anything above). */
export const VIDEO_MAX_DURATION_MS = 30_000;

export const VIDEO_DEFAULT_DURATION_MS = 5_000;

/** Pixels scrolled per choreography step when the client sends no scrollSpeed. */
export const VIDEO_DEFAULT_SCROLL_SPEED = 800;

export const VIDEO_MAX_SCROLL_SPEED = 5_000;

/** Pause between scroll steps; the deadline math caps every wait at the remainder. */
export const VIDEO_SCROLL_STEP_MS = 250;

/**
 * Defense-in-depth step bound (240 x 250ms = 60s of instant waits): the hard
 * Date.now deadline always binds first when waits elapse in real time; this
 * caps the loop when waits resolve instantly (fakes, wedged timers).
 */
export const VIDEO_MAX_SCROLL_STEPS = 240;

const MIME_BY_VIDEO_FORMAT: Record<VideoFormat, VideoMime> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
};

export interface VideoCaptureRequest {
  readonly url: string;
  readonly format: VideoFormat;
  readonly durationMs: number;
  readonly scrollSpeed?: number;
  readonly scrollEasing?: ScrollEasing;
  readonly viewport?: { readonly width: number; readonly height: number };
}

export interface VideoCaptureResult {
  readonly buffer: Buffer;
  readonly mime: VideoMime;
  readonly bytes: number;
}

/** One scroll-choreography step (serializable: crosses page.evaluate). */
export interface ScrollStep {
  readonly pixels: number;
}

/**
 * Runs in the page context via page.evaluate, so it must stay self-contained
 * (no Node imports or outer closures): step down, wrap to top at the bottom.
 */
export function scrollPageBy(step: ScrollStep): void {
  window.scrollBy(0, step.pixels);
  const maxY = document.documentElement.scrollHeight - window.innerHeight;
  if (window.scrollY >= maxY) window.scrollTo(0, 0);
}

/** Narrow page contract the scroll choreography needs (real Page or a fake). */
export interface VideoPage {
  readonly goto: (url: string, options?: { readonly timeout?: number }) => Promise<void>;
  readonly evaluate: (fn: (step: ScrollStep) => void, step: ScrollStep) => Promise<void>;
  readonly waitForTimeout: (ms: number) => Promise<void>;
  readonly video: () => { readonly path: () => Promise<string> } | null;
  readonly close: () => Promise<void>;
}

/** Narrow context contract (real BrowserContext or a fake). */
export interface VideoContext {
  readonly newPage: () => Promise<VideoPage>;
  readonly close: () => Promise<void>;
}

export interface VideoContextOptions extends ContextViewportOptions {
  readonly recordVideo: { readonly dir: string };
}

export interface VideoCaptureDeps {
  readonly newContext?: (opts: VideoContextOptions) => Promise<VideoContext>;
}

/** Page-load timeout tuning + overall capture budget (mirrors pipeline.ts resolveTimeout). */
export type VideoTimeouts = CaptureTimeouts & { readonly overallMs?: number };

function resolveTimeout(timeouts?: VideoTimeouts): number {
  const requested = timeouts?.defaultMs ?? DEFAULT_CAPTURE_TIMEOUT_MS;
  return Math.min(requested, timeouts?.capMs ?? DEFAULT_CAPTURE_TIMEOUT_CAP_MS);
}

function adaptPage(page: Page): VideoPage {
  return {
    goto: (url, options) =>
      page
        .goto(url, {
          ...(options?.timeout !== undefined ? { timeout: options.timeout } : {}),
          waitUntil: 'load',
        })
        .then(() => undefined),
    evaluate: (fn, step) => page.evaluate(fn, step).then(() => undefined),
    waitForTimeout: (ms) => page.waitForTimeout(ms),
    video: () => {
      const recording = page.video();
      return recording === null ? null : { path: () => recording.path() };
    },
    close: () => page.close().then(() => undefined),
  };
}

function adaptContext(context: BrowserContext): VideoContext {
  return {
    newPage: async () => adaptPage(await context.newPage()),
    close: () => context.close(),
  };
}

async function defaultNewVideoContext(opts: VideoContextOptions): Promise<VideoContext> {
  return adaptContext(await baseNewContext(opts));
}

/**
 * Scroll choreography bounded by a hard deadline: at most
 * VIDEO_MAX_SCROLL_STEPS iterations and never past startedAt + durationMs
 * (capped at VIDEO_MAX_DURATION_MS). Every wait is capped at the remainder.
 */
async function runScrollChoreography(page: VideoPage, req: VideoCaptureRequest, timeouts?: VideoTimeouts): Promise<void> {
  const durationMs = Math.min(req.durationMs, VIDEO_MAX_DURATION_MS);
  const pixels = req.scrollSpeed ?? VIDEO_DEFAULT_SCROLL_SPEED;
  const deadline = Date.now() + durationMs;
  const overallDeadline = timeouts?.overallMs !== undefined ? Date.now() + timeouts.overallMs : undefined;
  let steps = 0;
  while (steps < VIDEO_MAX_SCROLL_STEPS && Date.now() < deadline) {
    if (overallDeadline !== undefined && Date.now() >= overallDeadline) {
      throw new CaptureError(`video capture exceeded overall budget (${timeouts?.overallMs}ms) for ${req.url}`);
    }
    await page.evaluate(scrollPageBy, { pixels });
    steps += 1;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    if (overallDeadline !== undefined) {
      const overallRemaining = overallDeadline - Date.now();
      if (overallRemaining <= 0) {
        throw new CaptureError(`video capture exceeded overall budget (${timeouts?.overallMs}ms) for ${req.url}`);
      }
      await page.waitForTimeout(Math.min(VIDEO_SCROLL_STEP_MS, remaining, overallRemaining));
    } else {
      await page.waitForTimeout(Math.min(VIDEO_SCROLL_STEP_MS, remaining));
    }
  }
}

async function findStagedVideo(dir: string): Promise<string | undefined> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return undefined;
  }
  const videos = entries.filter((entry) => entry.endsWith('.webm')).sort();
  const first = videos[0] ?? [...entries].sort()[0];
  return first === undefined ? undefined : join(dir, first);
}

async function recordToBuffer(
  req: VideoCaptureRequest,
  factory: (opts: VideoContextOptions) => Promise<VideoContext>,
  stagingDir: string,
  timeouts?: VideoTimeouts,
): Promise<VideoCaptureResult> {
  const viewportOpts: ContextViewportOptions = req.viewport !== undefined ? { viewport: req.viewport } : {};
  // TODO(video-wire): browser.newContext does not forward recordVideo yet;
  // Object.assign carries the dir to the seam (fakes assert it) until the
  // forwarding lands with the T8 wiring.
  const context = await factory(Object.assign(viewportOpts, { recordVideo: { dir: stagingDir } }));
  let videoPath: string | undefined;
  try {
    const page = await context.newPage();
    try {
      await page.goto(req.url, { timeout: resolveTimeout(timeouts) });
      await runScrollChoreography(page, req, timeouts);
      const recording = page.video();
      if (recording !== null) videoPath = await recording.path();
    } finally {
      await page.close();
    }
  } finally {
    // Context close finalizes the recording file before it is read below.
    await context.close();
  }
  videoPath ??= await findStagedVideo(stagingDir);
  if (videoPath === undefined) throw new CaptureError(`video capture produced no recording for ${req.url}`);
  const buffer = await readFile(videoPath);
  return { buffer, mime: MIME_BY_VIDEO_FORMAT[req.format], bytes: buffer.length };
}

/**
 * Scroll-capture a URL to an in-memory video: fresh staging dir under the OS
 * tmp root, Playwright recordVideo context, deadline-bounded scroll
 * choreography, then close (finalizes the file) -> read -> Buffer.
 * Persistence stays with the route wiring (existing storeArtifact); this
 * returns the artifact-ready result. recordVideo only — no transcoding pipeline.
 */
export async function captureVideo(
  req: VideoCaptureRequest,
  deps?: VideoCaptureDeps,
  timeouts?: VideoTimeouts,
): Promise<VideoCaptureResult> {
  const factory = deps?.newContext ?? defaultNewVideoContext;
  const stagingDir = await mkdtemp(join(tmpdir(), 'webcap-video-'));
  try {
    return await recordToBuffer(req, factory, stagingDir, timeouts);
  } catch (err) {
    if (err instanceof CaptureError) throw err;
    throw new CaptureError(`video capture failed for ${req.url}: ${errorMessage(err)}`, { cause: err });
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
