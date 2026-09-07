/**
 * ML pipeline type definitions.
 *
 * Adapted from agentic-graph/src/graph/types.ts with webcap-specific
 * ML pipeline semantics.
 */

// --- Status types ---
export type MLPipelineStatus =
  | 'created'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type MLNodeStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

// --- Node types ---
export type MLNodeType =
  | 'capture'      // Take screenshot
  | 'classify'     // Page classification
  | 'extract'      // Content extraction
  | 'detect'       // Object detection (YOLO)
  | 'ocr'          // Text extraction (OCR)
  | 'analyze'      // Visual analysis
  | 'ground'       // Screen grounding (fuse UI + OCR + visual)
  | 'merge'        // Merge results from parallel branches
  | 'condition';   // Conditional branching

// --- Retry policy ---
export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly backoff: 'none' | 'linear' | 'exponential';
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
}

// --- Node definition ---
export interface MLNodeDefinition {
  readonly type: MLNodeType;
  readonly prompt?: string;
  readonly input?: Record<string, string>;
  readonly output?: Record<string, unknown>;
  readonly timeoutMs?: number;
  readonly retry?: RetryPolicy;
  readonly dependsOn?: string[];
}

// --- Edge definition ---
export interface MLEdgeDefinition {
  readonly from: string;
  readonly to: string;
  readonly condition?: string;
}

// --- Pipeline definition ---
export interface MLPipelineDefinition {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly description?: string;
  readonly nodes: Record<string, MLNodeDefinition>;
  readonly edges: MLEdgeDefinition[];
  readonly entryNodes: string[];
}

// --- Run state ---
export interface MLRunInput {
  readonly url: string;
  readonly tasks: string[];
  readonly options?: Record<string, unknown>;
}

export interface MLRunState {
  readonly runId: string;
  readonly pipelineId: string;
  readonly pipelineVersion: number;
  readonly status: MLPipelineStatus;
  readonly input: MLRunInput;
  readonly nodeStates: Record<string, MLNodeState>;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

// --- Node state ---
export interface MLNodeState {
  readonly nodeId: string;
  readonly status: MLNodeStatus;
  readonly attempts: number;
  readonly input?: Record<string, unknown>;
  readonly output?: Record<string, unknown>;
  readonly error?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

// --- Event types ---
export type MLNodeEventType =
  | 'node_started'
  | 'node_completed'
  | 'node_failed'
  | 'node_skipped';

export interface MLNodeEvent {
  readonly type: MLNodeEventType;
  readonly runId: string;
  readonly nodeId: string;
  readonly timestamp: string;
  readonly payload?: Record<string, unknown>;
}

// --- Scheduler config ---
export interface MLSchedulerConfig {
  readonly maxConcurrentNodes: number;
  readonly tickIntervalMs?: number;
}

// --- Predefined pipeline templates ---

/**
 * Standard page analysis pipeline:
 * capture → classify + detect + ocr (parallel) → ground → merge
 */
export function standardAnalysisPipeline(): MLPipelineDefinition {
  return {
    id: 'standard-analysis',
    version: 1,
    name: 'Standard Page Analysis',
    description: 'Capture screenshot, classify page, detect objects, extract text, ground results',
    nodes: {
      capture: {
        type: 'capture',
        timeoutMs: 30_000,
      },
      classify: {
        type: 'classify',
        dependsOn: ['capture'],
        timeoutMs: 15_000,
      },
      detect: {
        type: 'detect',
        dependsOn: ['capture'],
        timeoutMs: 15_000,
      },
      ocr: {
        type: 'ocr',
        dependsOn: ['capture'],
        timeoutMs: 15_000,
      },
      ground: {
        type: 'ground',
        dependsOn: ['detect', 'ocr'],
        timeoutMs: 5_000,
      },
      merge: {
        type: 'merge',
        dependsOn: ['classify', 'ground'],
      },
    },
    edges: [
      { from: 'capture', to: 'classify' },
      { from: 'capture', to: 'detect' },
      { from: 'capture', to: 'ocr' },
      { from: 'detect', to: 'ground' },
      { from: 'ocr', to: 'ground' },
      { from: 'classify', to: 'merge' },
      { from: 'ground', to: 'merge' },
    ],
    entryNodes: ['capture'],
  };
}

/**
 * Entity extraction pipeline:
 * capture → extract → classify (for context) → merge
 */
export function entityExtractionPipeline(): MLPipelineDefinition {
  return {
    id: 'entity-extraction',
    version: 1,
    name: 'Entity Extraction',
    description: 'Capture screenshot, extract content, classify page type, extract entities',
    nodes: {
      capture: {
        type: 'capture',
        timeoutMs: 30_000,
      },
      extract: {
        type: 'extract',
        dependsOn: ['capture'],
        timeoutMs: 15_000,
      },
      classify: {
        type: 'classify',
        dependsOn: ['capture'],
        timeoutMs: 15_000,
      },
      merge: {
        type: 'merge',
        dependsOn: ['extract', 'classify'],
      },
    },
    edges: [
      { from: 'capture', to: 'extract' },
      { from: 'capture', to: 'classify' },
      { from: 'extract', to: 'merge' },
      { from: 'classify', to: 'merge' },
    ],
    entryNodes: ['capture'],
  };
}

/**
 * Visual comparison pipeline:
 * capture_old + capture_new → diff → merge
 */
export function visualDiffPipeline(): MLPipelineDefinition {
  return {
    id: 'visual-diff',
    version: 1,
    name: 'Visual Diff',
    description: 'Compare two screenshots and detect visual changes',
    nodes: {
      capture_old: {
        type: 'capture',
        timeoutMs: 30_000,
      },
      capture_new: {
        type: 'capture',
        timeoutMs: 30_000,
      },
      diff: {
        type: 'analyze',
        dependsOn: ['capture_old', 'capture_new'],
        prompt: 'Compare these two screenshots and describe the visual differences',
        timeoutMs: 15_000,
      },
      merge: {
        type: 'merge',
        dependsOn: ['diff'],
      },
    },
    edges: [
      { from: 'capture_old', to: 'diff' },
      { from: 'capture_new', to: 'diff' },
      { from: 'diff', to: 'merge' },
    ],
    entryNodes: ['capture_old', 'capture_new'],
  };
}
