import { describe, expect, it } from 'vitest';
import { parseMacroSteps, parseWatchAuth } from '../../src/server/macro-parse.js';
import { HttpError } from '../../src/util/errors.js';

function expectUnprocessable(fn: () => unknown, fragment: string): void {
  try {
    fn();
    expect.unreachable('expected parser to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    if (err instanceof HttpError) {
      expect(err.status).toBe(422);
      expect(err.message).toContain(fragment);
    }
  }
}

describe('server/macro-parse parseMacroSteps', () => {
  it('passes through valid click/type/wait/goto steps unchanged', () => {
    expect(
      parseMacroSteps(
        [
          { type: 'goto', url: 'https://example.com/login' },
          { type: 'type', selector: '#user', text: 'alice' },
          { type: 'type', selector: '#pass', text: 's3cr3t' },
          { type: 'click', selector: '#submit' },
          { type: 'wait', timeoutMs: 500 },
        ],
        undefined,
      ),
    ).toEqual([
      { type: 'goto', url: 'https://example.com/login' },
      { type: 'type', selector: '#user', text: 'alice' },
      { type: 'type', selector: '#pass', text: 's3cr3t' },
      { type: 'click', selector: '#submit' },
      { type: 'wait', timeoutMs: 500 },
    ]);
  });

  it('caps a wait-step timeoutMs above the cap down to the cap', () => {
    expect(parseMacroSteps([{ type: 'wait', timeoutMs: 120_000 }], undefined)).toEqual([
      { type: 'wait', timeoutMs: 10_000 },
    ]);
  });

  it('rejects more than 5 steps with 422', () => {
    const steps = Array.from({ length: 6 }, () => ({ type: 'click', selector: '#x' }));
    expectUnprocessable(() => parseMacroSteps(steps, undefined), 'macro');
  });

  it.each([[{}], ['click'], [null], [{ type: 'click', selector: '#x' }]])(
    'rejects non-array steps %o with 422',
    (steps) => {
      expectUnprocessable(() => parseMacroSteps(steps, undefined), 'macro');
    },
  );

  it('rejects an empty steps array with 422', () => {
    expectUnprocessable(() => parseMacroSteps([], undefined), 'macro');
  });

  it.each([[['hover']], [['scroll']], [[42]], [[null]], [['']]])(
    'rejects unknown step type %o with 422',
    ([type]) => {
      expectUnprocessable(() => parseMacroSteps([{ type, selector: '#x' }], undefined), 'macro');
    },
  );

  it('rejects a click step with a missing or blank selector with 422', () => {
    expectUnprocessable(() => parseMacroSteps([{ type: 'click' }], undefined), 'macro');
    expectUnprocessable(() => parseMacroSteps([{ type: 'click', selector: '   ' }], undefined), 'macro');
  });

  it('rejects a type step with missing text with 422', () => {
    expectUnprocessable(() => parseMacroSteps([{ type: 'type', selector: '#q' }], undefined), 'macro');
    expectUnprocessable(() => parseMacroSteps([{ type: 'type', selector: '#q', text: '' }], undefined), 'macro');
  });

  it('rejects a wait step with a missing or non-positive timeoutMs with 422', () => {
    expectUnprocessable(() => parseMacroSteps([{ type: 'wait' }], undefined), 'macro');
    expectUnprocessable(() => parseMacroSteps([{ type: 'wait', timeoutMs: 0 }], undefined), 'macro');
  });

  it('rejects a goto step with a missing url with 422', () => {
    expectUnprocessable(() => parseMacroSteps([{ type: 'goto' }], undefined), 'macro');
  });

  it('rejects a goto step targeting a blocked host (SSRF) with 422', () => {
    expectUnprocessable(() => parseMacroSteps([{ type: 'goto', url: 'http://localhost/admin' }], undefined), 'url');
    expectUnprocessable(() => parseMacroSteps([{ type: 'goto', url: 'http://127.0.0.1/admin' }], undefined), 'url');
  });

  it('rejects a goto step with a non-http(s) scheme with 422', () => {
    expectUnprocessable(() => parseMacroSteps([{ type: 'goto', url: 'file:///etc/passwd' }], undefined), 'url');
  });

  it('accepts a goto step targeting an allowlisted host', () => {
    expect(parseMacroSteps([{ type: 'goto', url: 'http://localhost:3000/login' }], ['localhost'])).toEqual([
      { type: 'goto', url: 'http://localhost:3000/login' },
    ]);
  });
});

describe('server/macro-parse parseWatchAuth', () => {
  it('returns undefined for undefined input', () => {
    expect(parseWatchAuth(undefined)).toBeUndefined();
  });

  it('passes through allowlisted headers unchanged', () => {
    expect(
      parseWatchAuth({ headers: { authorization: 'Bearer s3cr3t', 'x-api-key': 'k-123' } }),
    ).toEqual({ headers: { authorization: 'Bearer s3cr3t', 'x-api-key': 'k-123' } });
  });

  it('rejects a non-allowlisted header with 422', () => {
    expectUnprocessable(() => parseWatchAuth({ headers: { 'x-evil': '1' } }), 'header');
  });

  it('rejects a non-object headers value with 422', () => {
    expectUnprocessable(() => parseWatchAuth({ headers: 'Bearer s3cr3t' }), 'header');
  });

  it('rejects an empty header value with 422', () => {
    expectUnprocessable(() => parseWatchAuth({ headers: { authorization: '   ' } }), 'header');
  });

  it('passes through cookies with name/value and optional domain', () => {
    expect(
      parseWatchAuth({
        cookies: [
          { name: 'sid', value: 'abc' },
          { name: 'sess', value: 'def', domain: 'example.com' },
        ],
      }),
    ).toEqual({
      cookies: [
        { name: 'sid', value: 'abc' },
        { name: 'sess', value: 'def', domain: 'example.com' },
      ],
    });
  });

  it('rejects a cookie missing name or value with 422', () => {
    expectUnprocessable(() => parseWatchAuth({ cookies: [{ value: 'abc' }] }), 'cookie');
    expectUnprocessable(() => parseWatchAuth({ cookies: [{ name: 'sid' }] }), 'cookie');
    expectUnprocessable(() => parseWatchAuth({ cookies: [{ name: '', value: 'abc' }] }), 'cookie');
  });

  it('rejects a non-array cookies value with 422', () => {
    expectUnprocessable(() => parseWatchAuth({ cookies: { name: 'sid', value: 'abc' } }), 'cookie');
  });

  it('rejects a non-object auth value with 422', () => {
    expectUnprocessable(() => parseWatchAuth('Bearer s3cr3t'), 'auth');
    expectUnprocessable(() => parseWatchAuth(42), 'auth');
  });
});
