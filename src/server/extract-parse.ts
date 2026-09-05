import type { PageStructure } from '../capture/pipeline.js';
import { unprocessable } from '../util/errors.js';
import { isRecord, validatedUrl } from './capture-parse.js';

export const MAX_EXTRACT_BATCH = 10;

export type ExtractedContent = PageStructure & { readonly extracted?: Record<string, unknown> };

export type ExtractResult =
  | { readonly url: string; readonly status: 'ok'; readonly data: ExtractedContent }
  | { readonly url: string; readonly status: 'error'; readonly error: string };

/** Normalize the extract request's targets: `urls` (string[], batch) or `url` (single string). */
export function parseExtractUrls(body: unknown, allowHosts: readonly string[] | undefined): string[] {
  if (!isRecord(body)) throw unprocessable('body must be an object');
  const rawBatch = body['urls'];
  const rawSingle = body['url'];
  const rawUrls: readonly unknown[] = Array.isArray(rawBatch) ? rawBatch : typeof rawSingle === 'string' ? [rawSingle] : [];
  if (rawUrls.length === 0) throw unprocessable('provide url (string) or urls (string[])');
  if (rawUrls.length > MAX_EXTRACT_BATCH) throw unprocessable(`urls must be at most ${MAX_EXTRACT_BATCH} items`);
  return rawUrls.map((raw) => {
    if (typeof raw !== 'string') throw unprocessable('each url must be a string');
    return validatedUrl(raw, allowHosts);
  });
}

/** Optional model-extraction schema: a natural-language description of the JSON object to return. */
export function parseExtractSchema(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const raw = body['schema'];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw.trim() === '') throw unprocessable('schema must be a non-empty string');
  return raw.trim();
}
