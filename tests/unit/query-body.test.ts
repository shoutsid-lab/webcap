/**
 * The GET form of a paid route: the query string stands in for the JSON body.
 * The coercion is the whole contract, so it is pinned here — a value that
 * silently changes type would turn a valid paid GET into a 422 after the payer
 * had already signed.
 */
import { describe, expect, it } from 'vitest';
import { coerceQueryValue, queryToBody } from '../../src/server/query-body.js';

describe('paid-GET query coercion', () => {
  it('leaves ordinary strings alone', () => {
    for (const value of [
      'https://example.com/',
      'https://example.com/path?a=1',
      'png',
      'classification',
      '#f0f0f0',
      'example.com',
      '',
    ]) {
      expect(coerceQueryValue(value), value).toBe(value);
    }
  });

  it('gives numbers, booleans and null their JSON type', () => {
    expect(coerceQueryValue('100')).toBe(100);
    expect(coerceQueryValue('-1.5')).toBe(-1.5);
    expect(coerceQueryValue('0')).toBe(0);
    expect(coerceQueryValue('true')).toBe(true);
    expect(coerceQueryValue('false')).toBe(false);
    expect(coerceQueryValue('null')).toBeNull();
  });

  it('decodes the JSON forms a POST body would carry as arrays or objects', () => {
    expect(coerceQueryValue('["https://a/","https://b/"]')).toEqual(['https://a/', 'https://b/']);
    expect(coerceQueryValue('{"maxContentWords":800}')).toEqual({ maxContentWords: 800 });
    expect(coerceQueryValue('"quoted"')).toBe('quoted');
  });

  it('keeps a malformed JSON-looking value as the string that was sent', () => {
    // A 422 naming the parameter is a better failure than a crash in the shim.
    expect(coerceQueryValue('{not json}')).toBe('{not json}');
    expect(coerceQueryValue('[unclosed')).toBe('[unclosed');
  });

  it('coerces every element of a repeated parameter', () => {
    expect(coerceQueryValue(['1', 'two', 'true'])).toEqual([1, 'two', true]);
  });

  it('builds the body a POST would have carried', () => {
    expect(
      queryToBody({
        url: 'https://example.com/',
        maxUrls: '5',
        options: '{"fullPage":true}',
      }),
    ).toEqual({
      url: 'https://example.com/',
      maxUrls: 5,
      options: { fullPage: true },
    });
  });
});
