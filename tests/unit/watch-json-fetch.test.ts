import { describe, expect, it, vi } from 'vitest';
import { fetchJsonWatch } from '../../src/watch/json-fetch.js';
import { stableStringify } from '../../src/watch/diff.js';

const JSON_URL = 'https://example.com/api/price';

function jsonResponse(body: string, contentType = 'application/json; charset=utf-8', status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

describe('fetchJsonWatch B-S1: plain JSON fetch', () => {
  it('fetches JSON and returns canonical (stableStringify) form', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse('{"b":2,"a":1}'));
    const result = await fetchJsonWatch(JSON_URL, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result).toEqual({
      ok: true,
      data: { b: 2, a: 1 },
      canonicalJson: stableStringify({ b: 2, a: 1 }),
    });
  });

  it('canonical form is independent of key insertion order', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse('{"z":{"b":1,"a":0},"a":[3,{"y":1,"x":0}]}'));
    const result = await fetchJsonWatch(JSON_URL, { fetchImpl });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.canonicalJson).toBe(stableStringify(JSON.parse('{"z":{"b":1,"a":0},"a":[3,{"y":1,"x":0}]}')));
    }
  });

  it('sends an Accept: application/json header', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse('{"a":1}'));
    await fetchJsonWatch(JSON_URL, { fetchImpl });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get('accept')).toContain('application/json');
  });
});

describe('fetchJsonWatch B-S2: failures become error results, never throws', () => {
  it('rejects non-JSON content-type as an error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse('<html></html>', 'text/html; charset=utf-8'));
    const result = await fetchJsonWatch(JSON_URL, { fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/content-type/i);
  });

  it('rejects invalid JSON bodies as an error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse('not json{{{'));
    const result = await fetchJsonWatch(JSON_URL, { fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid JSON/i);
  });

  it('rejects HTTP error statuses as an error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse('{"error":1}', 'application/json', 500));
    const result = await fetchJsonWatch(JSON_URL, { fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/500/);
  });

  it('rejects oversize bodies as an error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(JSON.stringify({ blob: 'x'.repeat(4096) })));
    const result = await fetchJsonWatch(JSON_URL, { fetchImpl, maxBytes: 128 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/oversize|too large/i);
  });

  it('rejects oversize content-length without reading the body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse('{"a":1}'));
    const oversized = new Response('{"a":1}', {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-length': String(10_000_000) },
    });
    fetchImpl.mockResolvedValueOnce(oversized);
    const result = await fetchJsonWatch(JSON_URL, { fetchImpl, maxBytes: 128 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/oversize|too large/i);
  });

  it('surfaces timeouts as an error instead of throwing', async () => {
    const hanging: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject((init.signal as AbortSignal).reason ?? new Error('aborted'));
        });
      });
    const result = await fetchJsonWatch(JSON_URL, { fetchImpl: hanging, timeoutMs: 20 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/timed out|abort/i);
  });

  it('blocks SSRF targets via the capture URL guard without fetching', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse('{"a":1}'));
    const result = await fetchJsonWatch('http://127.0.0.1/latest', { fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not allowed|invalid URL|unsupported/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('converts a throwing fetch into an error result', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('boom');
    });
    const result = await fetchJsonWatch(JSON_URL, { fetchImpl });
    expect(result).toEqual({ ok: false, error: 'boom' });
  });
});
