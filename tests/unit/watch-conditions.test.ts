import { describe, expect, it } from 'vitest';
import {
  conditionsMatch,
  isValidJsonPath,
  parseConditionsField,
  resolveJsonPath,
  type ConditionContext,
  type WatchCondition,
} from '../../src/watch/conditions.js';

const CTX_MARKDOWN: ConditionContext = {
  markdown: '# Example Domain\n\nThe price today is 49.99 USD.',
  extract: { title: 'Example Domain', price: 49.99 },
};

describe('isValidJsonPath (tiny hand-rolled subset)', () => {
  it('accepts the documented subset: $.a.b.0.c, brackets, bare $', () => {
    for (const path of ['$', '$.a', '$.a.b', '$.a.b.0.c', '$.items[0].price', '$.a.0.b', '$.a_b2.c3']) {
      expect(isValidJsonPath(path)).toBe(true);
    }
  });

  it('rejects anything outside the subset', () => {
    for (const path of [
      '',
      'a',
      '$.',
      '$.a..b',
      '$..a',
      '$.a b',
      '$.a[',
      '$.a[-1]',
      "$['a']",
      '$.a.*',
      '$.a[0',
    ]) {
      expect(isValidJsonPath(path)).toBe(false);
    }
  });
});

describe('resolveJsonPath', () => {
  const doc = { a: { b: [{ c: 42 }, { c: 43 }] }, title: 'hi' };

  it('resolves the canonical nested path $.a.b.0.c', () => {
    expect(resolveJsonPath(doc, '$.a.b.0.c')).toEqual({ ok: true, value: 42 });
  });

  it('resolves bracket indexing the same as dot indexing', () => {
    expect(resolveJsonPath(doc, '$.a.b[1].c')).toEqual({ ok: true, value: 43 });
  });

  it('resolves bare $ to the whole document', () => {
    expect(resolveJsonPath(doc, '$')).toEqual({ ok: true, value: doc });
  });

  it('fails closed on missing keys, out-of-bounds indices, and leaf descent', () => {
    expect(resolveJsonPath(doc, '$.missing').ok).toBe(false);
    expect(resolveJsonPath(doc, '$.a.b.9.c').ok).toBe(false);
    expect(resolveJsonPath(doc, '$.title.deeper').ok).toBe(false);
  });

  it('fails closed on invalid paths (never throws)', () => {
    const resolved = resolveJsonPath(doc, 'not-a-path');
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.reason).toMatch(/invalid jsonPath/);
  });
});

describe('conditionsMatch: keyword vs markdown', () => {
  it('matches a markdown substring case-insensitively', () => {
    expect(conditionsMatch([{ type: 'keyword', keyword: 'example domain' }], CTX_MARKDOWN)).toBe(true);
    expect(conditionsMatch([{ type: 'keyword', keyword: 'PRICE TODAY' }], CTX_MARKDOWN)).toBe(true);
  });

  it('does not match an absent phrase', () => {
    expect(conditionsMatch([{ type: 'keyword', keyword: 'no-such-phrase-xyz' }], CTX_MARKDOWN)).toBe(false);
  });

  it('falls back to the extract JSON when markdown is null', () => {
    const ctx: ConditionContext = { markdown: null, extract: { title: 'Fallback Title Here' } };
    expect(conditionsMatch([{ type: 'keyword', keyword: 'fallback title' }], ctx)).toBe(true);
    expect(conditionsMatch([{ type: 'keyword', keyword: 'absent' }], ctx)).toBe(false);
  });

  it('never matches a keyword when there is nothing to search', () => {
    const ctx: ConditionContext = { markdown: null, extract: null };
    expect(conditionsMatch([{ type: 'keyword', keyword: 'anything' }], ctx)).toBe(false);
  });
});

describe('conditionsMatch: priceBelow/priceAbove vs extract JSON', () => {
  const ctx: ConditionContext = {
    markdown: null,
    extract: { price: 49.99, nested: { offers: [{ amount: 10 }, { amount: 200 }] } },
  };

  it('priceBelow matches strictly below, not at or above', () => {
    expect(conditionsMatch([{ type: 'priceBelow', jsonPath: '$.price', price: 50 }], ctx)).toBe(true);
    expect(conditionsMatch([{ type: 'priceBelow', jsonPath: '$.price', price: 49.99 }], ctx)).toBe(false);
    expect(conditionsMatch([{ type: 'priceBelow', jsonPath: '$.price', price: 10 }], ctx)).toBe(false);
  });

  it('priceAbove matches strictly above, not at or below', () => {
    expect(conditionsMatch([{ type: 'priceAbove', jsonPath: '$.price', price: 49 }], ctx)).toBe(true);
    expect(conditionsMatch([{ type: 'priceAbove', jsonPath: '$.price', price: 49.99 }], ctx)).toBe(false);
    expect(conditionsMatch([{ type: 'priceAbove', jsonPath: '$.price', price: 100 }], ctx)).toBe(false);
  });

  it('resolves nested indexed paths ($.nested.offers.0.amount)', () => {
    expect(conditionsMatch([{ type: 'priceBelow', jsonPath: '$.nested.offers.0.amount', price: 11 }], ctx)).toBe(true);
    expect(conditionsMatch([{ type: 'priceAbove', jsonPath: '$.nested.offers.1.amount', price: 199 }], ctx)).toBe(true);
  });

  it('is false for non-numeric values, missing paths, and null extracts', () => {
    const stringPrice: ConditionContext = { markdown: null, extract: { price: '49.99' } };
    expect(conditionsMatch([{ type: 'priceBelow', jsonPath: '$.price', price: 50 }], stringPrice)).toBe(false);
    expect(conditionsMatch([{ type: 'priceBelow', jsonPath: '$.absent', price: 50 }], ctx)).toBe(false);
    expect(
      conditionsMatch([{ type: 'priceBelow', jsonPath: '$.price', price: 50 }], { markdown: null, extract: null }),
    ).toBe(false);
  });
});

describe('conditionsMatch: AND semantics + legacy empty', () => {
  it('requires every condition to match (AND)', () => {
    const both: WatchCondition[] = [
      { type: 'keyword', keyword: 'example' },
      { type: 'priceBelow', jsonPath: '$.price', price: 50 },
    ];
    expect(conditionsMatch(both, CTX_MARKDOWN)).toBe(true);
    const oneUnmet: WatchCondition[] = [
      { type: 'keyword', keyword: 'example' },
      { type: 'priceBelow', jsonPath: '$.price', price: 10 },
    ];
    expect(conditionsMatch(oneUnmet, CTX_MARKDOWN)).toBe(false);
  });

  it('empty conditions match everything (legacy changed-only watches)', () => {
    expect(conditionsMatch([], CTX_MARKDOWN)).toBe(true);
    expect(conditionsMatch([], { markdown: null, extract: null })).toBe(true);
  });
});

describe('parseConditionsField (create-time validation)', () => {
  it('returns null when the field is absent', () => {
    expect(parseConditionsField(undefined)).toBeNull();
  });

  it('accepts a well-formed condition list unchanged', () => {
    const conditions: WatchCondition[] = [
      { type: 'keyword', keyword: 'restock' },
      { type: 'priceBelow', jsonPath: '$.a.b.0.c', price: 100 },
    ];
    expect(parseConditionsField(structuredClone(conditions))).toEqual(conditions);
  });

  it('rejects invalid jsonPath with a 422 (one case per bad shape)', () => {
    for (const jsonPath of ['not-a-path', '$.', '$.a..b', "$['a']"]) {
      let caught: unknown;
      try {
        parseConditionsField([{ type: 'priceBelow', jsonPath, price: 10 }]);
      } catch (err) {
        caught = err;
      }
      expect(caught).toMatchObject({ status: 422 });
    }
  });

  it('rejects unknown types, empty keywords, and non-finite prices with a 422', () => {
    const bad: unknown[] = [
      [{ type: 'nope', keyword: 'x' }],
      [{ type: 'keyword', keyword: '' }],
      [{ type: 'keyword' }],
      [{ type: 'priceBelow', jsonPath: '$.a', price: Number.NaN }],
      [{ type: 'priceBelow', jsonPath: '$.a', price: '10' }],
      [{ type: 'priceAbove', jsonPath: '$.a' }],
      'keyword',
      '[{"type":"keyword"}]',
    ];
    for (const conditions of bad) {
      let caught: unknown;
      try {
        parseConditionsField(conditions);
      } catch (err) {
        caught = err;
      }
      expect(caught).toMatchObject({ status: 422 });
    }
  });
});
