import { describe, expect, it } from 'vitest';
import {
  standardAnalysisPipeline,
  entityExtractionPipeline,
  visualDiffPipeline,
} from '../../src/ml/pipeline/types.js';
import { ML_PIPELINE_SCHEMA, initializeMLDatabase } from '../../src/ml/pipeline/schema.js';

describe('ml/pipeline/types', () => {
  describe('standardAnalysisPipeline', () => {
    it('returns a valid pipeline definition', () => {
      const pipeline = standardAnalysisPipeline();
      expect(pipeline.id).toBe('standard-analysis');
      expect(pipeline.version).toBe(1);
      expect(pipeline.name).toBe('Standard Page Analysis');
    });

    it('has required nodes', () => {
      const pipeline = standardAnalysisPipeline();
      expect(pipeline.nodes.capture).toBeDefined();
      expect(pipeline.nodes.classify).toBeDefined();
      expect(pipeline.nodes.detect).toBeDefined();
      expect(pipeline.nodes.ocr).toBeDefined();
      expect(pipeline.nodes.ground).toBeDefined();
      expect(pipeline.nodes.merge).toBeDefined();
    });

    it('has entry nodes', () => {
      const pipeline = standardAnalysisPipeline();
      expect(pipeline.entryNodes).toEqual(['capture']);
    });

    it('has edges connecting nodes', () => {
      const pipeline = standardAnalysisPipeline();
      expect(pipeline.edges.length).toBeGreaterThan(0);
    });

    it('defines dependencies correctly', () => {
      const pipeline = standardAnalysisPipeline();
      expect(pipeline.nodes.classify.dependsOn).toEqual(['capture']);
      expect(pipeline.nodes.detect.dependsOn).toEqual(['capture']);
      expect(pipeline.nodes.ocr.dependsOn).toEqual(['capture']);
      expect(pipeline.nodes.ground.dependsOn).toEqual(['detect', 'ocr']);
      expect(pipeline.nodes.merge.dependsOn).toEqual(['classify', 'ground']);
    });
  });

  describe('entityExtractionPipeline', () => {
    it('returns a valid pipeline definition', () => {
      const pipeline = entityExtractionPipeline();
      expect(pipeline.id).toBe('entity-extraction');
      expect(pipeline.version).toBe(1);
    });

    it('has required nodes', () => {
      const pipeline = entityExtractionPipeline();
      expect(pipeline.nodes.capture).toBeDefined();
      expect(pipeline.nodes.extract).toBeDefined();
      expect(pipeline.nodes.classify).toBeDefined();
      expect(pipeline.nodes.merge).toBeDefined();
    });
  });

  describe('visualDiffPipeline', () => {
    it('returns a valid pipeline definition', () => {
      const pipeline = visualDiffPipeline();
      expect(pipeline.id).toBe('visual-diff');
      expect(pipeline.version).toBe(1);
    });

    it('has two capture nodes', () => {
      const pipeline = visualDiffPipeline();
      expect(pipeline.nodes.capture_old).toBeDefined();
      expect(pipeline.nodes.capture_new).toBeDefined();
    });

    it('has diff node with prompt', () => {
      const pipeline = visualDiffPipeline();
      expect(pipeline.nodes.diff.prompt).toContain('Compare');
    });

    it('has multiple entry nodes', () => {
      const pipeline = visualDiffPipeline();
      expect(pipeline.entryNodes).toContain('capture_old');
      expect(pipeline.entryNodes).toContain('capture_new');
    });
  });
});

describe('ml/pipeline/schema', () => {
  it('exports valid schema string', () => {
    expect(ML_PIPELINE_SCHEMA).toBeDefined();
    expect(typeof ML_PIPELINE_SCHEMA).toBe('string');
    expect(ML_PIPELINE_SCHEMA).toContain('CREATE TABLE');
  });

  it('schema contains required tables', () => {
    expect(ML_PIPELINE_SCHEMA).toContain('ml_pipelines');
    expect(ML_PIPELINE_SCHEMA).toContain('ml_runs');
    expect(ML_PIPELINE_SCHEMA).toContain('ml_node_runs');
    expect(ML_PIPELINE_SCHEMA).toContain('ml_events');
    expect(ML_PIPELINE_SCHEMA).toContain('ml_analysis_results');
  });

  it('schema contains indexes', () => {
    expect(ML_PIPELINE_SCHEMA).toContain('CREATE INDEX');
  });
});
