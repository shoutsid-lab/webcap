import { describe, expect, it } from 'vitest';
import { executeJsonWatch, type JsonFetchResult } from '../../src/watch/json-fetch.js';
import { stableStringify } from '../../src/watch/diff.js';

function okFetch(data: unknown): () => Promise<JsonFetchResult> {
  return async () => ({ ok: true, data, canonicalJson: stableStringify(data) });
}

function errFetch(error: string): () => Promise<JsonFetchResult> {
  return async () => ({ ok: false, error });
}

describe('executeJsonWatch B-S1: baseline store + changed detection', () => {
  it('first run stores the baseline with changed=false', async () => {
    const data = { price: 49.99, title: 'widget' };
    const outcome = await executeJsonWatch({
      baselineJson: null,
      conditionsJson: null,
      fetch: okFetch(data),
    });
    expect(outcome).toEqual({
      status: 'ok',
      extractJson: stableStringify(data),
      changed: false,
      diffSummary: null,
      conditionsMet: true,
      error: null,
    });
  });

  it('identical rerun reports changed=false', async () => {
    const data = { price: 49.99, items: [1, 2] };
    const outcome = await executeJsonWatch({
      baselineJson: stableStringify({ items: [1, 2], price: 49.99 }),
      conditionsJson: null,
      fetch: okFetch(data),
    });
    expect(outcome.status).toBe('ok');
    expect(outcome.changed).toBe(false);
    expect(outcome.diffSummary).toBeNull();
  });

  it('changed fields report changed=true with stably-ordered diff paths', async () => {
    const outcome = await executeJsonWatch({
      baselineJson: stableStringify({ price: 49.99, title: 'old' }),
      conditionsJson: null,
      fetch: okFetch({ price: 39.99, title: 'old' }),
    });
    expect(outcome.status).toBe('ok');
    expect(outcome.changed).toBe(true);
    expect(outcome.diffSummary).toBe('price');
  });
});

describe('executeJsonWatch B-S1: keyword/priceBelow gate via conditionsMatch', () => {
  it('keyword condition passes when the JSON text contains the keyword', async () => {
    const outcome = await executeJsonWatch({
      baselineJson: null,
      conditionsJson: JSON.stringify([{ type: 'keyword', keyword: 'widget' }]),
      fetch: okFetch({ title: 'Blue Widget Pro' }),
    });
    expect(outcome.status).toBe('ok');
    expect(outcome.conditionsMet).toBe(true);
  });

  it('keyword condition fails when the JSON text lacks the keyword', async () => {
    const outcome = await executeJsonWatch({
      baselineJson: null,
      conditionsJson: JSON.stringify([{ type: 'keyword', keyword: 'widget' }]),
      fetch: okFetch({ title: 'Red Gadget' }),
    });
    expect(outcome.status).toBe('ok');
    expect(outcome.conditionsMet).toBe(false);
  });

  it('priceBelow condition passes when the JSON-path value is below the threshold', async () => {
    const outcome = await executeJsonWatch({
      baselineJson: null,
      conditionsJson: JSON.stringify([{ type: 'priceBelow', jsonPath: '$.price', price: 50 }]),
      fetch: okFetch({ price: 49.99 }),
    });
    expect(outcome.status).toBe('ok');
    expect(outcome.conditionsMet).toBe(true);
  });

  it('priceBelow condition fails when the JSON-path value is above the threshold', async () => {
    const outcome = await executeJsonWatch({
      baselineJson: null,
      conditionsJson: JSON.stringify([{ type: 'priceBelow', jsonPath: '$.price', price: 50 }]),
      fetch: okFetch({ price: 60 }),
    });
    expect(outcome.status).toBe('ok');
    expect(outcome.conditionsMet).toBe(false);
  });
});

describe('executeJsonWatch B-S2: error status, never throw', () => {
  it('fetch failure becomes an error outcome', async () => {
    const outcome = await executeJsonWatch({
      baselineJson: null,
      conditionsJson: null,
      fetch: errFetch('json fetch failed: unexpected content-type text/html'),
    });
    expect(outcome).toEqual({
      status: 'error',
      extractJson: null,
      changed: false,
      diffSummary: null,
      conditionsMet: false,
      error: 'json fetch failed: unexpected content-type text/html',
    });
  });

  it('throwing fetch becomes an error outcome instead of throwing', async () => {
    const outcome = await executeJsonWatch({
      baselineJson: null,
      conditionsJson: null,
      fetch: async () => {
        throw new Error('network down');
      },
    });
    expect(outcome.status).toBe('error');
    expect(outcome.error).toBe('network down');
    expect(outcome.extractJson).toBeNull();
  });

  it('unparseable stored conditions fail closed with conditionsMet=false', async () => {
    const outcome = await executeJsonWatch({
      baselineJson: null,
      conditionsJson: 'not-json{{{',
      fetch: okFetch({ price: 1 }),
    });
    expect(outcome.status).toBe('ok');
    expect(outcome.conditionsMet).toBe(false);
  });

  it('unparseable stored baseline becomes an error outcome', async () => {
    const outcome = await executeJsonWatch({
      baselineJson: 'not-json{{{',
      conditionsJson: null,
      fetch: okFetch({ price: 1 }),
    });
    expect(outcome.status).toBe('error');
    expect(outcome.error).toMatch(/baseline/i);
  });
});
