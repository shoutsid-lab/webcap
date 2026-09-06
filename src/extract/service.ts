/**
 * The shared extract orchestration: the single implementation behind the
 * /v1/x402/extract route (src/server/routes.ts) and the watch scheduler's
 * extract runs (src/watch/scheduler.ts).
 *
 * Both call sites keep their own error mapping around extractPage (the route
 * reports per-URL failures in the batch response; the scheduler records them
 * on the run row) and their own model timeout/logger values — this module
 * owns the fetch→model→merge sequence, the MIME map, and artifact storage.
 */
import type { ArtifactRepo } from '../db/artifacts.js';
import type { WebcapConfig } from '../config.js';
import type { CaptureFormat, CaptureRequest, CaptureResult, StructuredCapture } from '../capture/pipeline.js';
import { modelExtract, type ModelConfig } from './model.js';
import type { ServiceLogger } from '../util/logger.js';
import type { ExtractedContent } from '../server/extract-parse.js';

/** Content type served for a stored artifact, per capture format. */
export const MIME_BY_FORMAT: Record<CaptureFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  pdf: 'application/pdf',
};

/**
 * Persist a capture artifact and return its public share URL.
 * (Was an inline closure in routes.ts and a mirror function in scheduler.ts.)
 */
export function storeArtifact(
  artifacts: ArtifactRepo,
  config: WebcapConfig,
  sourceUrl: string,
  result: CaptureResult,
): string {
  const id = crypto.randomUUID();
  artifacts.store({
    id,
    sourceUrl,
    format: result.format,
    mime: MIME_BY_FORMAT[result.format],
    bytes: result.buffer,
  });
  return `${config.publicBaseUrl}/v1/artifacts/${id}`;
}

export interface ExtractPageOptions {
  /** The URL to extract. */
  readonly url: string;
  /** The capture pipeline surface (AppDeps.captureStructured / WatchPipeline.captureStructured). */
  readonly captureStructured: (req: CaptureRequest) => Promise<StructuredCapture>;
  /** Optional model-extraction schema; null/undefined selects structure-only output. */
  readonly schema?: string | null;
  /** OpenAI-compatible model endpoint config. */
  readonly model: ModelConfig;
  /** Forwarded to modelExtract verbatim (its built-in default applies when undefined). */
  readonly modelTimeoutMs?: number;
  /** Forwarded to modelExtract verbatim (its built-in default applies when undefined). */
  readonly logger?: ServiceLogger;
}

/**
 * One extract run: structured capture (HTML only when a model will actually
 * run), optional model extraction, structure+extracted merge.
 *
 * Never swallows capture errors — callers map them to their own per-URL route
 * error or run-row error.
 */
export async function extractPage(options: ExtractPageOptions): Promise<ExtractedContent> {
  const schema = options.schema;
  const modelConfigured =
    options.model.apiKey !== '' && options.model.baseUrl !== '' && options.model.model !== '';
  const wantsModel = schema !== null && schema !== undefined && modelConfigured;
  const captured = await options.captureStructured({ url: options.url, options: { includeHtml: wantsModel } });
  let extracted: Record<string, unknown> | undefined;
  if (schema !== null && schema !== undefined && modelConfigured) {
    extracted = await modelExtract(captured.html, schema, options.model, options.modelTimeoutMs, options.logger);
  }
  return extracted === undefined ? { ...captured.structure } : { ...captured.structure, extracted };
}
