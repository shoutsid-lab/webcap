import { describe, expect, it } from 'vitest';
import { validateAgainstSchema, verifySpans } from '../../src/extract/schema-validator.js';
import { HttpError } from '../../src/util/errors.js';

function expectUnsupportedKeyword(schema: unknown): void {
  try {
    validateAgainstSchema({}, schema);
    expect.unreachable('expected validateAgainstSchema to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    if (err instanceof HttpError) {
      expect(err.status).toBe(422);
      expect(err.message).toContain('unsupported schema keyword');
    }
  }
}

function expectDollarRooted(errors: string[]): void {
  expect(errors.length).toBeGreaterThan(0);
  expect(errors.some((e: string) => e.startsWith('$'))).toBe(true);
}

describe('extract/schema-validator A-S1 validateAgainstSchema', () => {
  it('passes a valid object against its schema', () => {
    const schema = {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string' },
        count: { type: 'integer' },
      },
    };
    expect(validateAgainstSchema({ title: 'hello', count: 3 }, schema)).toEqual([]);
  });

  it('reports a wrong primitive type with a $-rooted path', () => {
    const errors: string[] = validateAgainstSchema(
      { title: 42 },
      { type: 'object', properties: { title: { type: 'string' } } },
    );
    expectDollarRooted(errors);
    expect(errors.join('\n')).toContain('$.title');
  });

  it('reports a missing required property with a $-rooted path', () => {
    const errors: string[] = validateAgainstSchema(
      {},
      { type: 'object', required: ['title'], properties: { title: { type: 'string' } } },
    );
    expectDollarRooted(errors);
    expect(errors.join('\n')).toContain('$.title');
  });

  it('reports an enum violation with a $-rooted path', () => {
    const errors: string[] = validateAgainstSchema('green', { type: 'string', enum: ['red', 'blue'] });
    expectDollarRooted(errors);
  });

  it('reports additionalProperties:false violations with a $-rooted path', () => {
    const errors: string[] = validateAgainstSchema(
      { title: 'hi', extra: true },
      {
        type: 'object',
        properties: { title: { type: 'string' } },
        additionalProperties: false,
      },
    );
    expectDollarRooted(errors);
    expect(errors.join('\n')).toContain('extra');
  });

  it.each([[{ oneOf: [{ type: 'string' }] }], [{ $ref: '#/defs/x' }], [{ type: 'string', format: 'date-time' }]])(
    'throws 422 unsupported schema keyword for %o',
    (schema) => {
      expectUnsupportedKeyword(schema);
    },
  );

  it('enforces integer: rejects 3.5, accepts 3', () => {
    const bad: string[] = validateAgainstSchema(3.5, { type: 'integer' });
    expect(bad.length).toBeGreaterThan(0);
    expect(validateAgainstSchema(3, { type: 'integer' })).toEqual([]);
  });

  it('enforces minLength/maxLength on strings', () => {
    const tooShort: string[] = validateAgainstSchema('ab', { type: 'string', minLength: 3 });
    expect(tooShort.length).toBeGreaterThan(0);
    const tooLong: string[] = validateAgainstSchema('abcd', { type: 'string', maxLength: 3 });
    expect(tooLong.length).toBeGreaterThan(0);
    expect(validateAgainstSchema('abc', { type: 'string', minLength: 1, maxLength: 5 })).toEqual([]);
  });

  it('enforces minimum/maximum on numbers', () => {
    const tooSmall: string[] = validateAgainstSchema(1, { type: 'number', minimum: 5 });
    expect(tooSmall.length).toBeGreaterThan(0);
    const tooBig: string[] = validateAgainstSchema(10, { type: 'number', maximum: 5 });
    expect(tooBig.length).toBeGreaterThan(0);
    expect(validateAgainstSchema(5, { type: 'number', minimum: 1, maximum: 10 })).toEqual([]);
  });

  it('enforces pattern on strings', () => {
    const bad: string[] = validateAgainstSchema('abc', { type: 'string', pattern: '^[0-9]+$' });
    expect(bad.length).toBeGreaterThan(0);
    expect(validateAgainstSchema('123', { type: 'string', pattern: '^[0-9]+$' })).toEqual([]);
  });
});

describe('extract/schema-validator A-S2 verifySpans', () => {
  const pages = ['the quick brown fox jumps', 'second page content here'];

  it('passes a verbatim quote substring with a valid page index', () => {
    const spans = [{ field: '$.title', quote: 'quick brown', page: 0 }];
    expect(verifySpans({ title: 'quick brown' }, spans, pages)).toEqual([]);
  });

  it('reports a missing (non-substring) span as span not grounded with the field path', () => {
    const errors: string[] = verifySpans(
      { title: 'hello' },
      [{ field: '$.title', quote: 'absent words', page: 0 }],
      pages,
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toContain('span not grounded');
    expect(errors.join('\n')).toContain('$.title');
  });

  it('reports a non-verbatim (case-differed) span as span not grounded', () => {
    const errors: string[] = verifySpans(
      { title: 'Quick Brown' },
      [{ field: '$.title', quote: 'quick brown', page: 0 }],
      pages,
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toContain('span not grounded');
    expect(errors.join('\n')).toContain('$.title');
  });

  it('reports an out-of-range page index as span not grounded with the field path', () => {
    const errors: string[] = verifySpans(
      { title: 'quick brown' },
      [{ field: '$.title', quote: 'quick brown', page: 9 }],
      pages,
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toContain('span not grounded');
    expect(errors.join('\n')).toContain('$.title');
  });

  it('performs zero model calls in the validator path (pure sync, no model stub)', () => {
    // Structural RED placeholder: the validator path takes (value, schema/spans, pages)
    // only — no model client, no fetch, no async. GREEN pins zero model calls via mock.
    expect(typeof validateAgainstSchema).toBe('function');
    expect(typeof verifySpans).toBe('function');
    const schema = { type: 'object', properties: { title: { type: 'string' } } };
    expect(validateAgainstSchema({ title: 'x' }, schema)).toEqual([]);
    expect(verifySpans({ title: 'x' }, [{ field: '$.title', quote: 'x', page: 0 }], ['x'])).toEqual([]);
  });
});
