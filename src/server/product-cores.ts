/**
 * The product compute cores shared by the x402 (per-call settlement) and
 * credits-rail (API-key account) routes.
 *
 * An agent runtime that holds a bearer token but no signing key cannot answer
 * an x402 challenge at all — so every paid product is also buyable with
 * credits. The cores below are the payment-agnostic middle: parse -> compute
 * -> result. The x402 wrappers add `_pendingRevenue` + the `payment` envelope;
 * the credits-rail wrappers charge 1 credit and refund it on failure. Moved
 * verbatim out of routes.ts (no behavior change); routes.ts keeps the revenue
 * halves.
 */
import {
  DEFAULT_MODEL_TIMEOUT_MS,
  type WebcapConfig,
} from '../config.js';
import { CaptureError } from '../capture/errors.js';
import { HttpError, unprocessable } from '../util/errors.js';
import { extractPage } from '../extract/service.js';
import { classifyPage } from '../ml/deterministic.js';
import type { ServiceLogger } from '../util/logger.js';
import {
  assertSupportedSchema,
  assertTypedExtractValid,
  filterExtractedBySchema,
  parseExtractSchema,
  parseExtractSpans,
  parseExtractUrls,
  parseTypedSchema,
  type ExtractResult,
} from './extract-parse.js';
import { isRecord, parseOptions, validatedUrl } from './capture-parse.js';
import { computeAudit, type AuditResult } from '../audit/checks.js';
import type { AppDeps } from './server.js';

/** The capture seam the cores need (a subset of AppDeps; type-only, no runtime cycle). */
export type ComputeDeps = Pick<AppDeps, 'captureStructured'>;

export interface ExtractComputeResult {
  readonly results: ExtractResult[];
  readonly urlCount: number;
}

/**
 * Run the paid extract compute: typed-schema fast path or schema/model path
 * with deterministic fallback. Throws 422 on bad input, 502 when every URL
 * fails — exactly as the x402 handler always has.
 */
export async function runExtractCompute(
  deps: ComputeDeps,
  config: WebcapConfig,
  log: ServiceLogger,
  body: unknown,
  allowHosts: readonly string[] | undefined,
): Promise<ExtractComputeResult> {
  const urls = parseExtractUrls(body, allowHosts);
  const typedSchema = parseTypedSchema(body);
  if (typedSchema !== undefined) {
    assertSupportedSchema(typedSchema);
    const spans = parseExtractSpans(body);
    const captureOptions = parseOptions(body);
    const results: ExtractResult[] = [];
    let failures = 0;
    for (const url of urls) {
      let captured;
      try {
        captured = await deps.captureStructured({
          url,
          options: { ...captureOptions, includeHtml: false },
        });
      } catch (err) {
        failures += 1;
        results.push({ url, status: 'error', error: err instanceof CaptureError ? err.message : 'capture failed' });
        continue;
      }
      const extracted = filterExtractedBySchema(captured.structure, typedSchema);
      assertTypedExtractValid(extracted, typedSchema, spans, [captured.structure.markdown]);
      results.push({ url, status: 'ok', data: { ...captured.structure, extracted, classification: classifyPage({ structure: captured.structure, pageUrl: url }) } });
    }
    if (failures === urls.length) {
      throw new HttpError(502, 'extract_failed', 'all urls failed to extract');
    }
    return { results, urlCount: urls.length };
  }
  const schema = parseExtractSchema(body);
  const captureOptions = parseOptions(body);
  const model = {
    baseUrl: config.modelApiBaseUrl,
    apiKey: config.modelApiKey,
    model: config.modelName,
  };
  const results: ExtractResult[] = [];
  let failures = 0;
  for (const url of urls) {
    let data;
    try {
      data = await extractPage({
        url,
        captureStructured: deps.captureStructured,
        schema,
        model,
        modelTimeoutMs: config.modelTimeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS,
        logger: log,
        ...(captureOptions !== undefined ? { captureOptions } : {}),
      });
    } catch (err) {
      // Model extraction failed - fall back to deterministic extraction
      // using extractPage with model disabled (schema provided but no model).
      try {
        data = await extractPage({
          url,
          captureStructured: deps.captureStructured,
          schema,
          model: { baseUrl: '', apiKey: '', model: '' }, // disable model
          modelTimeoutMs: 0,
          logger: log,
          ...(captureOptions !== undefined ? { captureOptions } : {}),
        });
      } catch (fallbackErr) {
        failures += 1;
        results.push({ url, status: 'error', error: fallbackErr instanceof CaptureError ? fallbackErr.message : 'capture failed' });
        continue;
      }
    }
    results.push({ url, status: 'ok', data: { ...data, classification: classifyPage({ structure: data, pageUrl: url }) } });
  }
  if (failures === urls.length) {
    throw new HttpError(502, 'extract_failed', 'all urls failed to extract');
  }
  return { results, urlCount: urls.length };
}

export interface AuditComputeResult {
  readonly url: string;
  readonly checks: AuditResult;
}

/** Run the paid audit compute: single-URL SEO + link/OG health. Throws 422/502 as the x402 handler always has. */
export async function runAuditCompute(
  deps: ComputeDeps,
  body: unknown,
  allowHosts: readonly string[] | undefined,
): Promise<AuditComputeResult> {
  const rawUrl = isRecord(body) ? body.url : undefined;
  if (typeof rawUrl !== 'string') throw unprocessable('url is required');
  const url = validatedUrl(rawUrl, allowHosts);
  let captured;
  try {
    captured = await deps.captureStructured({ url, options: { includeHtml: true } });
  } catch (err) {
    if (err instanceof CaptureError) throw new HttpError(502, 'audit_failed', err.message);
    throw err;
  }
  const checks = computeAudit({ structure: captured.structure, html: captured.html, pageUrl: url });
  return { url, checks };
}
