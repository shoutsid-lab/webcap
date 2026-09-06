import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { chromium } from 'playwright-core';
import { closeBrowser, newContext } from '../../src/capture/browser.js';
import { REDACT_PATHS } from '../../src/server/logging.js';
import { redactSecrets } from '../../src/util/redact.js';

vi.mock('playwright-core', () => ({
  chromium: {
    launch: vi.fn(async () => ({
      close: async () => undefined,
      newContext: vi.fn(async (opts: unknown) => ({
        addInitScript: async () => undefined,
        close: async () => undefined,
        captured: opts,
      })),
    })),
  },
}));

async function lastContextOptions(): Promise<Record<string, unknown>> {
  const launch = chromium.launch as unknown as Mock;
  const result = launch.mock.results[launch.mock.results.length - 1];
  if (result?.type !== 'return') throw new Error('expected chromium.launch to have returned');
  const browser = result.value as { newContext: Mock };
  const call = browser.newContext.mock.calls[browser.newContext.mock.calls.length - 1];
  return (call?.[0] ?? {}) as Record<string, unknown>;
}

afterEach(async () => {
  await closeBrowser();
  vi.clearAllMocks();
});

describe('browser newContext applies per-watch auth', () => {
  it('forwards extraHTTPHeaders to the Playwright context options', async () => {
    await newContext({ extraHTTPHeaders: { authorization: 'Bearer s3cr3t' } });
    expect(await lastContextOptions()).toMatchObject({
      extraHTTPHeaders: { authorization: 'Bearer s3cr3t' },
    });
  });

  it('forwards cookies to the Playwright context options', async () => {
    const cookies = [{ name: 'sid', value: 'abc', domain: 'example.com' }];
    await newContext({ cookies });
    expect(await lastContextOptions()).toMatchObject({ cookies });
  });

  it('forwards auth alongside viewport options', async () => {
    await newContext({
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: { 'x-api-key': 'k-123' },
      cookies: [{ name: 'sid', value: 'abc' }],
    });
    expect(await lastContextOptions()).toMatchObject({
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: { 'x-api-key': 'k-123' },
      cookies: [{ name: 'sid', value: 'abc' }],
    });
  });
});

describe('logging redacts auth secrets', () => {
  it('REDACT_PATHS covers authorization, cookie, and set-cookie headers', () => {
    const paths = [...REDACT_PATHS];
    expect(paths).toContain('req.headers.authorization');
    expect(paths).toContain('req.headers.cookie');
    expect(paths.some((p) => p.toLowerCase().includes('set-cookie'))).toBe(true);
  });

  it('redactSecrets censors authorization/cookie/set-cookie values (case-insensitive)', () => {
    const redacted = redactSecrets({
      headers: {
        Authorization: 'Bearer s3cr3t',
        Cookie: 'sid=abc',
        'Set-Cookie': 'sid=abc; HttpOnly',
        'content-type': 'application/json',
      },
    });
    expect(redacted).toEqual({
      headers: {
        Authorization: '[Redacted]',
        Cookie: '[Redacted]',
        'Set-Cookie': '[Redacted]',
        'content-type': 'application/json',
      },
    });
  });

  it('redactSecrets leaves no secret in the serialized log payload', () => {
    const payload = {
      method: 'POST',
      url: '/v1/watches',
      headers: { authorization: 'Bearer s3cr3t', cookie: 'sid=topsecret' },
      body: { auth: { headers: { authorization: 'Bearer s3cr3t' } } },
    };
    const serialized = JSON.stringify(redactSecrets(payload));
    expect(serialized).not.toContain('s3cr3t');
    expect(serialized).not.toContain('topsecret');
  });

  it('redactSecrets censors secrets nested in arrays', () => {
    const redacted = redactSecrets([{ cookie: 'sid=abc' }, { other: 'kept' }]);
    expect(redacted).toEqual([{ cookie: '[Redacted]' }, { other: 'kept' }]);
  });
});
