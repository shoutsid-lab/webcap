import { describe, expect, it } from 'vitest';
import { parseOptions } from '../../src/server/capture-parse.js';
import { HttpError } from '../../src/util/errors.js';

function expectUnprocessable(body: unknown, fragment: string): void {
  try {
    parseOptions(body);
    expect.unreachable('expected parseOptions to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    if (err instanceof HttpError) {
      expect(err.status).toBe(422);
      expect(err.message).toContain(fragment);
    }
  }
}

describe('server/capture-parse viewport/mobile options', () => {
  it('passes through an in-range viewport unchanged', () => {
    expect(parseOptions({ options: { viewport: { width: 1280, height: 800 } } })).toEqual({
      viewport: { width: 1280, height: 800 },
    });
  });

  it('clamps width below 320 up and above 3840 down', () => {
    expect(parseOptions({ options: { viewport: { width: 100, height: 800 } } })).toEqual({
      viewport: { width: 320, height: 800 },
    });
    expect(parseOptions({ options: { viewport: { width: 5000, height: 800 } } })).toEqual({
      viewport: { width: 3840, height: 800 },
    });
  });

  it('clamps height below 320 up and above 2160 down', () => {
    expect(parseOptions({ options: { viewport: { width: 1280, height: 100 } } })).toEqual({
      viewport: { width: 1280, height: 320 },
    });
    expect(parseOptions({ options: { viewport: { width: 1280, height: 5000 } } })).toEqual({
      viewport: { width: 1280, height: 2160 },
    });
  });

  it.each([[1280.5], ['1280'], [true], [null], [Number.NaN]])(
    'rejects non-integer width %o with 422',
    (width) => {
      expectUnprocessable({ options: { viewport: { width, height: 800 } } }, 'viewport');
    },
  );

  it.each([[800.5], ['800'], [true], [null], [Number.NaN]])(
    'rejects non-integer height %o with 422',
    (height) => {
      expectUnprocessable({ options: { viewport: { width: 1280, height } } }, 'viewport');
    },
  );

  it.each([['1280x800'], [[1280, 800]], [42], [true], [null]])(
    'rejects non-object viewport %o with 422',
    (viewport) => {
      expectUnprocessable({ options: { viewport } }, 'viewport');
    },
  );

  it('rejects a viewport missing width or height with 422', () => {
    expectUnprocessable({ options: { viewport: { width: 1280 } } }, 'viewport');
    expectUnprocessable({ options: { viewport: { height: 800 } } }, 'viewport');
    expectUnprocessable({ options: { viewport: {} } }, 'viewport');
  });

  it('passes through deviceScaleFactor within 1..3 (floats allowed)', () => {
    expect(parseOptions({ options: { deviceScaleFactor: 1 } })).toEqual({ deviceScaleFactor: 1 });
    expect(parseOptions({ options: { deviceScaleFactor: 2.5 } })).toEqual({ deviceScaleFactor: 2.5 });
    expect(parseOptions({ options: { deviceScaleFactor: 3 } })).toEqual({ deviceScaleFactor: 3 });
  });

  it('clamps deviceScaleFactor above 3 down to 3', () => {
    expect(parseOptions({ options: { deviceScaleFactor: 5 } })).toEqual({ deviceScaleFactor: 3 });
  });

  it.each([[0], [-1], [Number.NaN], [Number.POSITIVE_INFINITY], ['2'], [true], [null]])(
    'rejects deviceScaleFactor %o with 422',
    (deviceScaleFactor) => {
      expectUnprocessable({ options: { deviceScaleFactor } }, 'deviceScaleFactor');
    },
  );

  it.each([[true], [false]])('passes through isMobile %o unchanged', (isMobile) => {
    expect(parseOptions({ options: { isMobile } })).toEqual({ isMobile });
  });

  it.each([['yes'], [1], [0], [null]])('rejects isMobile %o with 422', (isMobile) => {
    expectUnprocessable({ options: { isMobile } }, 'isMobile');
  });

  it('passes through a userAgent string unchanged', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
    expect(parseOptions({ options: { userAgent: ua } })).toEqual({ userAgent: ua });
  });

  it.each([[42], [true], [null], [[]]])('rejects userAgent %o with 422', (userAgent) => {
    expectUnprocessable({ options: { userAgent } }, 'userAgent');
  });

  it('rejects an empty userAgent with 422', () => {
    expectUnprocessable({ options: { userAgent: '   ' } }, 'userAgent');
  });

  it('combines viewport/mobile fields with the existing timeoutMs/fullPage fields', () => {
    expect(
      parseOptions({
        options: {
          timeoutMs: 5000,
          fullPage: true,
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 2,
          isMobile: true,
          userAgent: 'mobile-ua',
        },
      }),
    ).toEqual({
      timeoutMs: 5000,
      fullPage: true,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      userAgent: 'mobile-ua',
    });
  });
});
