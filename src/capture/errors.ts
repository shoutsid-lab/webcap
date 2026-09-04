/** Typed failure of a capture or OG fetch (bad page, timeout, browser error). */
export class CaptureError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CaptureError';
  }
}
