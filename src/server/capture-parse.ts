import type { CaptureFormat, CaptureOptions } from '../capture/pipeline.js';
import { unprocessable } from '../util/errors.js';
import { validateCaptureUrl } from '../util/url.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseFormat(body: unknown): CaptureFormat {
  const raw = isRecord(body) ? body.format : undefined;
  if (raw === undefined) return 'png';
  if (raw === 'png' || raw === 'jpeg' || raw === 'pdf') return raw;
  throw unprocessable(`unsupported format: ${String(raw)}`);
}

export function parseOptions(body: unknown): CaptureOptions | undefined {
  const raw = isRecord(body) ? body.options : undefined;
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) throw unprocessable('options must be an object');
  const timeoutMs = raw.timeoutMs;
  const fullPage = raw.fullPage;
  if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs <= 0)) {
    throw unprocessable('timeoutMs must be a positive integer');
  }
  if (fullPage !== undefined && typeof fullPage !== 'boolean') {
    throw unprocessable('fullPage must be a boolean');
  }
  if (timeoutMs === undefined && fullPage === undefined) return undefined;
  return { timeoutMs, fullPage };
}

export function validatedUrl(raw: string, allowHosts: readonly string[] | undefined): string {
  try {
    return validateCaptureUrl(raw, { allowHosts });
  } catch {
    throw unprocessable('invalid url');
  }
}
