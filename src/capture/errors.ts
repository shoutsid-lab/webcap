/** Typed failure of a capture or OG fetch (bad page, timeout, browser error). */
export class CaptureError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CaptureError';
  }
}

/**
 * The video concurrency semaphore is exhausted: all capture slots are held.
 * Deliberately NOT a CaptureError — the route maps this to 429 video_busy
 * (back off and retry) instead of 502 video_failed (the page is broken).
 */
export class VideoBusyError extends Error {
  readonly status = 429;
  readonly code = 'video_busy';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'VideoBusyError';
  }
}
