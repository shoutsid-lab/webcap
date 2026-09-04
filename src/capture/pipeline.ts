import { newContext } from './browser.js';
import { CaptureError } from './errors.js';

export type CaptureFormat = 'png' | 'jpeg' | 'pdf';

export interface CaptureOptions {
  readonly timeoutMs?: number;
  readonly fullPage?: boolean;
}

export interface CaptureRequest {
  readonly url: string;
  readonly format?: CaptureFormat;
  readonly options?: CaptureOptions;
}

export interface CaptureResult {
  readonly buffer: Buffer;
  readonly format: CaptureFormat;
  readonly bytes: number;
}

export async function capture(req: CaptureRequest): Promise<CaptureResult> {
  const format: CaptureFormat = req.format ?? 'png';
  try {
    const context = await newContext();
    try {
      const page = await context.newPage();
      try {
        await page.goto(req.url, { timeout: req.options?.timeoutMs ?? 30_000, waitUntil: 'load' });
        const buffer =
          format === 'pdf' ? await page.pdf({}) : await page.screenshot({ fullPage: req.options?.fullPage, type: format });
        return { buffer, format, bytes: buffer.length };
      } finally {
        await page.close();
      }
    } finally {
      await context.close();
    }
  } catch (err) {
    if (err instanceof CaptureError) throw err;
    throw new CaptureError(`capture failed for ${req.url}: ${errorMessage(err)}`, { cause: err });
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
