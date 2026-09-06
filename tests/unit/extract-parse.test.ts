import { describe, expect, it } from 'vitest';
import { parseExtractSchema } from '../../src/server/extract-parse.js';
import { HttpError } from '../../src/util/errors.js';

function expectUnprocessable(body: unknown): void {
  try {
    parseExtractSchema(body);
    expect.unreachable('expected parseExtractSchema to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    if (err instanceof HttpError) {
      expect(err.status).toBe(422);
      expect(err.message).toContain('schema must be a non-empty string');
    }
  }
}

describe('server/extract-parse parseExtractSchema', () => {
  it('serializes an object schema to a JSON string', () => {
    expect(parseExtractSchema({ schema: { type: 'object' } })).toBe('{"type":"object"}');
  });

  it('serializes an object schema alongside urls', () => {
    expect(parseExtractSchema({ urls: ['https://example.com/'], schema: { type: 'object' } })).toBe(
      '{"type":"object"}',
    );
  });

  it('rejects an empty object schema with 422', () => {
    expectUnprocessable({ schema: {} });
  });

  it.each([[['title']], [42], [true], [null]])('rejects schema %o with 422', (schema) => {
    expectUnprocessable({ schema });
  });

  it('keeps the string path: trims, rejects blank, returns undefined when absent or body is not an object', () => {
    expect(parseExtractSchema({ schema: '  hello  ' })).toBe('hello');
    expectUnprocessable({ schema: '   ' });
    expect(parseExtractSchema({})).toBeUndefined();
    expect(parseExtractSchema('x')).toBeUndefined();
    expect(parseExtractSchema(null)).toBeUndefined();
  });
});
