/**
 * ML intelligence layer for webcap.
 *
 * Provides visual analysis, object detection, OCR, screen grounding,
 * and pipeline orchestration for web page understanding.
 *
 * Architecture:
 * - vision/  → OpenAI-compatible visual inference (ported from resonance-vision)
 * - detection/ → YOLO object detection + Tesseract OCR (ported from sensornet)
 * - pipeline/ → ML pipeline types and persistence (adapted from agentic-graph)
 */

// Vision analysis
export {
  OpenAICompatibleVisionAdapter,
  VisionError,
  VisionCancelled,
  VisionTimeout,
  VisionProviderError,
  type VisionAdapterConfig,
  type VisionExchange,
  type Transport,
  type AnalysisTask,
  type AnalysisResult,
  type MediaType,
  type ClassificationResult,
  type AccessibilityResult,
  type LayoutResult,
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
  canonicalJsonBytes,
  jsonDigest,
  strictJsonParse,
  validateBoundedJSON,
  extractMessageContent,
  extractUsage,
} from './vision/index.js';

// Object detection and OCR
export {
  type Bounds,
  type ObjectDetection,
  type OCRRegion,
  type OCRResult,
  type VisualTrack,
  type UIElement,
  type GroundedElement,
  type WorldSnapshot,
  boundsCenter,
  boundsArea,
  boundsValid,
  iou,
  detectObjects,
  extractTextFromImage,
  groundSnapshot,
  describeScreen,
  findGrounded,
  findElements,
} from './detection/index.js';

// Pipeline orchestration
export {
  type MLPipelineStatus,
  type MLNodeStatus,
  type MLNodeType,
  type RetryPolicy,
  type MLNodeDefinition,
  type MLEdgeDefinition,
  type MLPipelineDefinition,
  type MLRunInput,
  type MLRunState,
  type MLNodeState,
  type MLNodeEvent,
  type MLSchedulerConfig,
  standardAnalysisPipeline,
  entityExtractionPipeline,
  visualDiffPipeline,
  ML_PIPELINE_SCHEMA,
  initializeMLDatabase,
} from './pipeline/index.js';
