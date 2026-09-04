import { describe, expect, it } from 'vitest';
import { validateCaptureUrl } from '../../src/util/url.js';
import { HttpError } from '../../src/util/errors.js';

const rejected = [
  'http://localhost/',
  'http://127.0.0.1/',
  'http://10.0.0.5/',
  'http://192.168.1.1/',
  'http://169.254.169.254/',
  'http://172.16.0.1/',
  'http://0.0.0.0/',
  'http://[::1]/',
  'http://foo.local/',
  'ftp://example.com/x',
  'file:///etc/passwd',
  'javascript:alert(1)',
  '',
];

describe('util/url', () => {
  it('accepts http(s) URLs and returns the normalized form', () => {
    expect(validateCaptureUrl('https://example.com/ok')).toBe('https://example.com/ok');
    expect(validateCaptureUrl('http://EXAMPLE.com/a?b=1#frag')).toBe('http://example.com/a?b=1#frag');
  });

  it.each(rejected)('rejects %s with an HttpError', (raw) => {
    expect(() => validateCaptureUrl(raw)).toThrow(HttpError);
  });

  it('rejects private hosts with HTTP 400', () => {
    try {
      validateCaptureUrl('http://127.0.0.1/');
      expect.unreachable('expected validateCaptureUrl to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      if (err instanceof HttpError) expect(err.status).toBe(400);
    }
  });
});
