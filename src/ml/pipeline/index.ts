/**
 * ML pipeline module for webcap.
 *
 * Provides pipeline type definitions, schema, and predefined templates.
 */
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
  type MLNodeEventType,
  type MLNodeEvent,
  type MLSchedulerConfig,
  standardAnalysisPipeline,
  entityExtractionPipeline,
  visualDiffPipeline,
} from './types.js';

export {
  ML_PIPELINE_SCHEMA,
  initializeMLDatabase,
} from './schema.js';
