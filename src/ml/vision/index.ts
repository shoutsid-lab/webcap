/**
 * Vision analysis module for webcap ML features.
 *
 * Provides OpenAI-compatible visual inference with JSON schema enforcement,
 * bounded request/response handling, and comprehensive error handling.
 *
 * Ported from resonance-vision with TypeScript adaptations.
 */
export {
  OpenAICompatibleVisionAdapter,
  VisionError,
  VisionCancelled,
  VisionTimeout,
  VisionProviderError,
  type VisionAdapterConfig,
  type VisionExchange,
  type Transport,
} from './adapter.js';

export {
  type AnalysisTask,
  type AnalysisResult,
  type MediaType,
  type PageCategory,
  type AccessibilitySeverity,
  type EntityType,
  type ClassificationResult,
  type AccessibilityIssue,
  type AccessibilityResult,
  type LayoutElement,
  type LayoutResult,
  type DetectedEntity,
  type EntitiesResult,
  type SentimentResult,
  type DiffResult,
  type VisualAnalysisRequest,
  type VisualAnalysisResponse,
  ANALYSIS_TASKS,
  MEDIA_TYPES,
  PAGE_CATEGORIES,
  validateMediaType,
  validateTask,
  validateImageSignature,
  schemaForTask,
  classificationSchema,
  accessibilitySchema,
  entitiesSchema,
  sentimentSchema,
} from './contracts.js';

export {
  canonicalJsonBytes,
  jsonDigest,
  strictJsonParse,
  validateBoundedJSON,
  extractMessageContent,
  extractUsage,
} from './json.js';
