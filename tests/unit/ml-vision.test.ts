import { describe, expect, it } from 'vitest';
import {
  canonicalJsonBytes,
  jsonDigest,
  strictJsonParse,
  validateBoundedJSON,
  extractMessageContent,
  extractUsage,
} from '../../src/ml/vision/json.js';
import {
  validateMediaType,
  validateTask,
  validateImageSignature,
  schemaForTask,
  ANALYSIS_TASKS,
  MEDIA_TYPES,
  PAGE_CATEGORIES,
} from '../../src/ml/vision/contracts.js';

describe('ml/vision/json', () => {
  describe('canonicalJsonBytes', () => {
    it('produces sorted-key JSON with no whitespace', () => {
      const result = canonicalJsonBytes({ b: 2, a: 1 });
      expect(result.toString('utf-8')).toBe('{"a":1,"b":2}');
    });

    it('handles nested objects', () => {
      const result = canonicalJsonBytes({ z: { b: 2, a: 1 }, a: 1 });
      expect(result.toString('utf-8')).toBe('{"a":1,"z":{"a":1,"b":2}}');
    });
  });

  describe('jsonDigest', () => {
    it('returns SHA-256 hex digest', () => {
      const digest = jsonDigest({ test: 'value' });
      expect(digest).toMatch(/^[a-f0-9]{64}$/);
    });

    it('is deterministic', () => {
      const d1 = jsonDigest({ a: 1 });
      const d2 = jsonDigest({ a: 1 });
      expect(d1).toBe(d2);
    });

    it('changes with different input', () => {
      const d1 = jsonDigest({ a: 1 });
      const d2 = jsonDigest({ a: 2 });
      expect(d1).not.toBe(d2);
    });
  });

  describe('strictJsonParse', () => {
    it('parses valid JSON', () => {
      expect(strictJsonParse('{"a":1}')).toEqual({ a: 1 });
    });

    it('parses from Buffer', () => {
      expect(strictJsonParse(Buffer.from('[1,2,3]'))).toEqual([1, 2, 3]);
    });

    it('throws on invalid JSON', () => {
      expect(() => strictJsonParse('{invalid}')).toThrow();
    });
  });

  describe('validateBoundedJSON', () => {
    it('passes for small objects', () => {
      expect(() => validateBoundedJSON({ a: 1 })).not.toThrow();
    });

    it('rejects objects exceeding max depth', () => {
      // Build a deeply nested object programmatically
      let deep: Record<string, unknown> = {};
      for (let i = 0; i < 10; i++) {
        deep = { child: deep };
      }
      expect(() => validateBoundedJSON(deep, { maxDepth: 5 })).toThrow('depth limit');
    });

    it('rejects arrays exceeding max items', () => {
      const long = Array.from({ length: 100 }, (_, i) => i);
      expect(() => validateBoundedJSON(long, { maxItems: 50 })).toThrow('item limit');
    });

    it('rejects strings exceeding max length', () => {
      const long = { key: 'x'.repeat(1000) };
      expect(() => validateBoundedJSON(long, { maxStringLength: 100 })).toThrow('char limit');
    });
  });

  describe('extractMessageContent', () => {
    it('extracts string content', () => {
      const response = { choices: [{ message: { content: 'hello' } }] };
      expect(extractMessageContent(response)).toBe('hello');
    });

    it('extracts array content blocks', () => {
      const response = {
        choices: [{
          message: {
            content: [
              { type: 'text', text: 'hello' },
              { type: 'text', text: 'world' },
            ],
          },
        }],
      };
      expect(extractMessageContent(response)).toBe('helloworld');
    });

    it('returns undefined for empty choices', () => {
      expect(extractMessageContent({ choices: [] })).toBeUndefined();
    });

    it('returns undefined for missing content', () => {
      expect(extractMessageContent({ choices: [{ message: {} }] })).toBeUndefined();
    });
  });

  describe('extractUsage', () => {
    it('extracts usage stats', () => {
      const data = { usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } };
      expect(extractUsage(data)).toEqual({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      });
    });

    it('ignores invalid values', () => {
      const data = { usage: { prompt_tokens: -1, completion_tokens: NaN } };
      expect(extractUsage(data)).toEqual({});
    });

    it('returns empty for missing usage', () => {
      expect(extractUsage({})).toEqual({});
    });
  });
});

describe('ml/vision/contracts', () => {
  describe('validateMediaType', () => {
    it('accepts valid media types', () => {
      expect(validateMediaType('image/png')).toBe('image/png');
      expect(validateMediaType('image/jpeg')).toBe('image/jpeg');
      expect(validateMediaType('image/webp')).toBe('image/webp');
    });

    it('rejects invalid media types', () => {
      expect(() => validateMediaType('image/gif')).toThrow('Unsupported media type');
      expect(() => validateMediaType('text/plain')).toThrow('Unsupported media type');
    });
  });

  describe('validateTask', () => {
    it('accepts valid tasks', () => {
      expect(validateTask('classification')).toBe('classification');
      expect(validateTask('accessibility')).toBe('accessibility');
      expect(validateTask('entities')).toBe('entities');
    });

    it('rejects invalid tasks', () => {
      expect(() => validateTask('invalid')).toThrow('Unsupported analysis task');
    });
  });

  describe('validateImageSignature', () => {
    it('validates PNG signature', () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(validateImageSignature(png, 'image/png')).toBe(true);
    });

    it('validates JPEG signature', () => {
      const jpeg = Buffer.from([0xff, 0xd8, 0xff]);
      expect(validateImageSignature(jpeg, 'image/jpeg')).toBe(true);
    });

    it('validates WebP signature', () => {
      const webp = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x00, 0x00, 0x00, 0x00, // size
        0x57, 0x45, 0x42, 0x50, // WEBP
      ]);
      expect(validateImageSignature(webp, 'image/webp')).toBe(true);
    });

    it('rejects mismatched signature', () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(validateImageSignature(png, 'image/jpeg')).toBe(false);
    });
  });

  describe('schemaForTask', () => {
    it('returns schema for classification', () => {
      const schema = schemaForTask('classification');
      expect(schema).toBeDefined();
      expect(schema?.type).toBe('object');
    });

    it('returns schema for accessibility', () => {
      const schema = schemaForTask('accessibility');
      expect(schema).toBeDefined();
    });

    it('returns schema for entities', () => {
      const schema = schemaForTask('entities');
      expect(schema).toBeDefined();
    });

    it('returns schema for sentiment', () => {
      const schema = schemaForTask('sentiment');
      expect(schema).toBeDefined();
    });

    it('returns undefined for layout', () => {
      expect(schemaForTask('layout')).toBeUndefined();
    });

    it('returns undefined for diff', () => {
      expect(schemaForTask('diff')).toBeUndefined();
    });
  });

  describe('ANALYSIS_TASKS', () => {
    it('contains all expected tasks', () => {
      expect(ANALYSIS_TASKS.has('classification')).toBe(true);
      expect(ANALYSIS_TASKS.has('accessibility')).toBe(true);
      expect(ANALYSIS_TASKS.has('layout')).toBe(true);
      expect(ANALYSIS_TASKS.has('diff')).toBe(true);
      expect(ANALYSIS_TASKS.has('entities')).toBe(true);
      expect(ANALYSIS_TASKS.has('sentiment')).toBe(true);
    });
  });

  describe('PAGE_CATEGORIES', () => {
    it('contains expected categories', () => {
      expect(PAGE_CATEGORIES.has('article')).toBe(true);
      expect(PAGE_CATEGORIES.has('product')).toBe(true);
      expect(PAGE_CATEGORIES.has('documentation')).toBe(true);
      expect(PAGE_CATEGORIES.has('landing-page')).toBe(true);
    });
  });
});
