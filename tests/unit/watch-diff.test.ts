import { describe, expect, it } from 'vitest';
import { diffJson, sha256Hex, stableStringify } from '../../src/watch/diff.js';

describe('sha256Hex', () => {
  it('matches the known sha256 of the empty byte string', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches the known sha256 of "abc"', () => {
    expect(sha256Hex(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('differs for different byte content (capture change detection)', () => {
    expect(sha256Hex(Buffer.from('v1'))).not.toBe(sha256Hex(Buffer.from('v2')));
  });
});

describe('stableStringify', () => {
  it('sorts object keys at every level', () => {
    const a = { b: { d: 1, c: [3, { z: 0, a: 1 }] }, a: 2 };
    expect(stableStringify(a)).toBe('{"a":2,"b":{"c":[3,{"a":1,"z":0}],"d":1}}');
  });

  it('is independent of key insertion order', () => {
    expect(stableStringify({ x: 1, y: 2 })).toBe(stableStringify({ y: 2, x: 1 }));
  });
});

describe('diffJson', () => {
  it('reports no change for identical values', () => {
    const value = { title: 't', paragraphs: ['a', 'b'], meta: { author: 'x' } };
    const diff = diffJson(value, { title: 't', paragraphs: ['a', 'b'], meta: { author: 'x' } });
    expect(diff).toEqual({ changed: false, paths: [] });
  });

  it('ignores top-level key ordering', () => {
    expect(diffJson({ a: 1, b: 2 }, { b: 2, a: 1 }).changed).toBe(false);
  });

  it('reports a changed top-level leaf by name', () => {
    const diff = diffJson({ title: 'old' }, { title: 'new' });
    expect(diff.changed).toBe(true);
    expect(diff.paths).toEqual(['title']);
  });

  it('reports a changed nested object field by dotted path', () => {
    const diff = diffJson({ meta: { author: 'a', year: 1 } }, { meta: { author: 'b', year: 1 } });
    expect(diff.paths).toEqual(['meta.author']);
  });

  it('reports an added and a removed key', () => {
    const diff = diffJson({ kept: 1, gone: 2 }, { kept: 1, added: 3 });
    expect(diff.changed).toBe(true);
    expect(diff.paths).toEqual(['added', 'gone']);
  });

  it('reports a changed array element by index', () => {
    const diff = diffJson(
      { paragraphs: ['one', 'two', 'three'] },
      { paragraphs: ['one', 'TWO', 'three'] },
    );
    expect(diff.paths).toEqual(['paragraphs[1]']);
  });

  it('reports array growth and shrinkage at the missing index', () => {
    expect(diffJson({ list: [1, 2] }, { list: [1, 2, 3] }).paths).toEqual(['list[2]']);
    expect(diffJson({ list: [1, 2, 3] }, { list: [1, 2] }).paths).toEqual(['list[2]']);
  });

  it('reports a nested object inside an array by index + dotted path', () => {
    const diff = diffJson(
      { links: [{ href: 'a', text: 't' }, { href: 'b', text: 'u' }] },
      { links: [{ href: 'a', text: 't' }, { href: 'B', text: 'u' }] },
    );
    expect(diff.paths).toEqual(['links[1].href']);
  });

  it('stably orders multiple changed paths (sorted keys, ascending indices)', () => {
    const diff = diffJson(
      { z: 1, a: 1, paragraphs: ['x', 'y'], links: [{ href: '1' }, { href: '2' }] },
      { z: 2, a: 2, paragraphs: ['x', 'Z'], links: [{ href: '1' }, { href: '9' }] },
    );
    expect(diff.paths).toEqual(['a', 'links[1].href', 'paragraphs[1]', 'z']);
  });

  it('treats a type mismatch (object vs leaf, array vs object) as changed at the path', () => {
    expect(diffJson({ f: { a: 1 } }, { f: 'now-a-string' }).paths).toEqual(['f']);
    expect(diffJson({ f: [1] }, { f: { 0: 1 } }).paths).toEqual(['f']);
    expect(diffJson({ f: null }, { f: {} }).paths).toEqual(['f']);
  });

  it('treats null vs false vs 0 as distinct leaf values', () => {
    expect(diffJson({ v: null }, { v: false }).changed).toBe(true);
    expect(diffJson({ v: 0 }, { v: false }).changed).toBe(true);
    expect(diffJson({ v: null }, { v: null }).changed).toBe(false);
  });

  it('matches the documented summary shape (title, paragraphs[2], links[0])', () => {
    const base = {
      title: 'Example Domain',
      paragraphs: ['p0', 'p1', 'p2'],
      links: [{ href: 'https://iana.org' }, { href: 'https://webcap' }],
    };
    const next = {
      title: 'Example Domain (edited)',
      paragraphs: ['p0', 'p1', 'CHANGED'],
      links: [{ href: 'CHANGED' }, { href: 'https://webcap' }],
    };
    const diff = diffJson(base, next);
    expect(diff.changed).toBe(true);
    expect(diff.paths.join(', ')).toBe('links[0].href, paragraphs[2], title');
  });
});
