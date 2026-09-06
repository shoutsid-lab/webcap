/**
 * The model-extract boot-time warning: MODEL_EXTRACT_DISABLED_WARNING (the
 * warning string) and modelExtractionDisabled (true when x402 is live but the
 * MODEL_* env vars are unset/empty). Split out of config.ts as a pure move
 * (no behavior change); config.ts re-exports both so every existing import
 * from config.ts keeps resolving.
 */
import type { WebcapConfig } from '../config.js';

/** Boot-time warning: x402 is live but the model-based extract feature is off. */
export const MODEL_EXTRACT_DISABLED_WARNING = 'webcap model extraction disabled: MODEL_API_* not configured — extract returns structure only';
/** True when x402 is enabled but any of MODEL_API_BASE_URL/MODEL_API_KEY/MODEL_NAME is missing/empty. */
export const modelExtractionDisabled = (c: WebcapConfig): boolean => c.x402Network !== undefined && (c.modelApiBaseUrl === '' || c.modelApiKey === '' || c.modelName === '');
