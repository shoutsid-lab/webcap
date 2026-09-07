/**
 * Visual analysis request/response contracts for webcap ML features.
 *
 * Inspired by resonance-vision's contracts.py but adapted for web-specific
 * visual analysis tasks (classification, accessibility, layout, diff).
 */

// --- Media types ---
export const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'] as const);
export type MediaType = 'image/png' | 'image/jpeg' | 'image/webp';

// --- Analysis task types ---
export const ANALYSIS_TASKS = new Set([
  'classification',
  'accessibility',
  'layout',
  'diff',
  'entities',
  'sentiment',
] as const);
export type AnalysisTask = 'classification' | 'accessibility' | 'layout' | 'diff' | 'entities' | 'sentiment';

// --- Page classification categories ---
export const PAGE_CATEGORIES = new Set([
  'article',
  'product',
  'documentation',
  'landing-page',
  'forum',
  'social-media',
  'e-commerce',
  'news',
  'blog',
  'wiki',
  'dashboard',
  'form',
  'other',
] as const);
export type PageCategory = typeof PAGE_CATEGORIES extends Set<infer T> ? T : never;

// --- Accessibility severity levels ---
export const ACCESSIBILITY_SEVERITIES = new Set(['error', 'warning', 'info'] as const);
export type AccessibilitySeverity = 'error' | 'warning' | 'info';

// --- Entity types ---
export const ENTITY_TYPES = new Set([
  'person',
  'organization',
  'product',
  'location',
  'date',
  'price',
  'url',
  'email',
  'phone',
] as const);
export type EntityType = typeof ENTITY_TYPES extends Set<infer T> ? T : never;

// --- Request interfaces ---

export interface VisualAnalysisRequest {
  readonly imageBytes: Buffer;
  readonly mediaType: MediaType;
  readonly task: AnalysisTask;
  readonly schema?: Record<string, unknown>;
  readonly context?: string;
}

// --- Response interfaces ---

export interface ClassificationResult {
  readonly category: PageCategory;
  readonly confidence: number;
  readonly subcategories?: string[];
  readonly tags?: string[];
}

export interface AccessibilityIssue {
  readonly severity: AccessibilitySeverity;
  readonly type: string;
  readonly message: string;
  readonly element?: string;
  readonly wcag?: string;
  readonly fix?: string;
}

export interface AccessibilityResult {
  readonly score: number;
  readonly issues: AccessibilityIssue[];
  readonly summary: string;
}

export interface LayoutElement {
  readonly type: string;
  readonly bounds: { x: number; y: number; width: number; height: number };
  readonly text?: string;
  readonly importance: 'high' | 'medium' | 'low';
}

export interface LayoutResult {
  readonly elements: LayoutElement[];
  readonly hierarchy: 'shallow' | 'medium' | 'deep';
  readonly readabilityScore: number;
  readonly summary: string;
}

export interface DetectedEntity {
  readonly type: EntityType;
  readonly value: string;
  readonly confidence: number;
  readonly startOffset?: number;
  readonly endOffset?: number;
}

export interface EntitiesResult {
  readonly entities: DetectedEntity[];
  readonly summary: string;
}

export interface SentimentResult {
  readonly sentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
  readonly confidence: number;
  readonly tone: 'formal' | 'informal' | 'technical' | 'conversational';
  readonly readabilityGrade: string;
  readonly summary: string;
}

export interface DiffResult {
  readonly changed: boolean;
  readonly changeType: 'content' | 'layout' | 'visual' | 'none';
  readonly similarity: number;
  readonly description: string;
}

export type AnalysisResult =
  | ClassificationResult
  | AccessibilityResult
  | LayoutResult
  | EntitiesResult
  | SentimentResult
  | DiffResult;

export interface VisualAnalysisResponse {
  readonly task: AnalysisTask;
  readonly result: AnalysisResult;
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly total_tokens?: number;
  };
  readonly latency_ms: number;
  readonly model?: string;
}

// --- Schema generation for structured output ---

export function classificationSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      category: { type: 'string', enum: Array.from(PAGE_CATEGORIES) },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      subcategories: { type: 'array', items: { type: 'string' }, maxItems: 5 },
      tags: { type: 'array', items: { type: 'string' }, maxItems: 10 },
    },
    required: ['category', 'confidence'],
  };
}

export function accessibilitySchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      score: { type: 'number', minimum: 0, maximum: 100 },
      issues: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            severity: { type: 'string', enum: ['error', 'warning', 'info'] },
            type: { type: 'string' },
            message: { type: 'string' },
            element: { type: 'string' },
            wcag: { type: 'string' },
            fix: { type: 'string' },
          },
          required: ['severity', 'type', 'message'],
        },
        maxItems: 50,
      },
      summary: { type: 'string' },
    },
    required: ['score', 'issues', 'summary'],
  };
}

export function entitiesSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      entities: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { type: 'string', enum: Array.from(ENTITY_TYPES) },
            value: { type: 'string' },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['type', 'value', 'confidence'],
        },
        maxItems: 100,
      },
      summary: { type: 'string' },
    },
    required: ['entities', 'summary'],
  };
}

export function sentimentSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral', 'mixed'] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      tone: { type: 'string', enum: ['formal', 'informal', 'technical', 'conversational'] },
      readabilityGrade: { type: 'string' },
      summary: { type: 'string' },
    },
    required: ['sentiment', 'confidence', 'tone', 'readabilityGrade', 'summary'],
  };
}

export function schemaForTask(task: AnalysisTask): Record<string, unknown> | undefined {
  switch (task) {
    case 'classification':
      return classificationSchema();
    case 'accessibility':
      return accessibilitySchema();
    case 'entities':
      return entitiesSchema();
    case 'sentiment':
      return sentimentSchema();
    case 'layout':
    case 'diff':
      return undefined; // These use custom prompts
  }
}

// --- Validation ---

export function validateMediaType(value: string): MediaType {
  if (!MEDIA_TYPES.has(value as MediaType)) {
    throw new Error(`Unsupported media type: ${value}. Supported: ${Array.from(MEDIA_TYPES).join(', ')}`);
  }
  return value as MediaType;
}

export function validateTask(value: string): AnalysisTask {
  if (!ANALYSIS_TASKS.has(value as AnalysisTask)) {
    throw new Error(`Unsupported analysis task: ${value}. Supported: ${Array.from(ANALYSIS_TASKS).join(', ')}`);
  }
  return value as AnalysisTask;
}

/**
 * Validate image bytes match declared media type via magic bytes.
 * Matches resonance-vision's _validate_media_signature().
 */
export function validateImageSignature(bytes: Buffer, mediaType: MediaType): boolean {
  if (mediaType === 'image/png') {
    return bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  }
  if (mediaType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mediaType === 'image/webp') {
    return bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
  return false;
}
