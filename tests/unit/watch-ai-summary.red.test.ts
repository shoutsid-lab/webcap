import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelConfig } from '../../src/extract/model.js';
// RED: this module does not exist yet (S-S1/S2/S3 GREEN comes later).
// Every test below must fail for exactly this reason until it is implemented.
import { modelSummarize } from '../../src/extract/modelSummarize.js';

// RED specs for watch AI summarization (modelSummarize), mirroring the
// conventions of src/extract/model.ts + tests/unit/model.test.ts:
//   S-S1 happy   — a diff string goes in, a summary string + token usage
//                  { prompt, completion, total } comes out.
//   S-S2 reason  — reasoning traces are stripped, array content blocks are
//                  joined, malformed output fails open with an
//                  "AI unevaluated — raw diff" marker, and fail-open results
//                  are never cached (cached is always false).
//   S-S3 retry   — transient 503s are retried; over-budget input resolves
//                  null and never throws.

const config: ModelConfig = {
  baseUrl: 'http://model.test/v1/',
  apiKey: 'test-api-key',
  model: 'test-model',
};

const DIFF = 'title: "Example Domain" -> "Example Domain (edited)"';

interface FakeRequestInit {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly signal: AbortSignal | undefined;
}

function mockFetch(impl: (url: string, init: FakeRequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

type FetchMock = ReturnType<typeof mockFetch>;

function firstCall(fn: FetchMock): [string, FakeRequestInit] {
  const call = fn.mock.calls[0];
  if (call === undefined) throw new Error('fetch was not called');
  return [call[0] as string, call[1] as FakeRequestInit];
}

/** A 200 chat/completions response with assistant `content` + token usage. */
function chatCompletion(content: string, usage?: { prompt: number; completion: number; total: number }): Response {
  const u = usage ?? { prompt: 10, completion: 5, total: 15 };
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: 'assistant', content } }],
      usage: { prompt_tokens: u.prompt, completion_tokens: u.completion, total_tokens: u.total },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('modelSummarize S-S1 (happy path)', () => {
  it('summarizes a diff string and returns usage { prompt, completion, total }', async () => {
    const fetchMock = mockFetch(() => chatCompletion('Title changed from "Example Domain" to "Example Domain (edited)".'));
    const result = await modelSummarize(DIFF, config);

    expect(result).not.toBeNull();
    expect(typeof result?.summary).toBe('string');
    expect(String(result?.summary)).toContain('Example Domain');
    expect(result?.usage).toEqual({ prompt: 10, completion: 5, total: 15 });
    expect(result?.cached).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('POSTs to <baseUrl without trailing slashes>/chat/completions with Bearer auth', async () => {
    const fetchMock = mockFetch(() => chatCompletion('summary'));

    await modelSummarize(DIFF, config);

    const [url, init] = firstCall(fetchMock);
    expect(url).toBe('http://model.test/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json', authorization: 'Bearer test-api-key' });
    expect(init.body).toContain(DIFF);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('modelSummarize S-S2 (reasoning hygiene + fail-open)', () => {
  it('strips <think> reasoning blocks from the summary', async () => {
    const fetchMock = mockFetch(() => chatCompletion('<think>private chain-of-thought</think>Price dropped to $9.'));

    const result = await modelSummarize(DIFF, config);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(result?.summary)).not.toContain('<think>');
    expect(String(result?.summary)).not.toContain('private chain-of-thought');
    expect(String(result?.summary)).toContain('Price dropped to $9.');
  });

  it('joins array content blocks into a single summary string', async () => {
    const fetchMock = mockFetch(
      () =>
        new Response(
          JSON.stringify({
            choices: [
              { message: { role: 'assistant', content: [{ type: 'text', text: 'Title changed. ' }, { type: 'text', text: 'Price dropped.' }] } },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );

    const result = await modelSummarize(DIFF, config);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result?.summary).toBe('Title changed. Price dropped.');
  });

  it('fails open with an "AI unevaluated — raw diff" marker on malformed output, never cached', async () => {
    const fetchMock = mockFetch(() => new Response('<html>bad gateway</html>', { status: 200 }));

    const result = await modelSummarize(DIFF, config);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(String(result?.summary)).toContain('AI unevaluated');
    expect(String(result?.summary)).toContain(DIFF);
    expect(result?.cached).toBe(false);
  });

  it('fails open (never null, never throws, never cached) when the response has no usable message content', async () => {
    const fetchMock = mockFetch(
      () => new Response('{"choices": []}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const result = await modelSummarize(DIFF, config);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(String(result?.summary)).toContain('AI unevaluated');
    expect(result?.cached).toBe(false);
  });
});

describe('modelSummarize S-S3 (retry + budget)', () => {
  it('retries a transient 503 and returns the summary from the retry', async () => {
    let calls = 0;
    const fetchMock = mockFetch(() => {
      calls += 1;
      if (calls === 1) return new Response('overloaded', { status: 503 });
      return chatCompletion('Recovered summary after 503.');
    });

    const result = await modelSummarize(DIFF, config, { maxRetries: 2 });

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result?.summary).toBe('Recovered summary after 503.');
    expect(result?.cached).toBe(false);
  });

  it('resolves null (never throws) when the diff is over budget', async () => {
    const fetchMock = mockFetch(() => chatCompletion('should never be reached'));

    const result = await modelSummarize('x'.repeat(100_000), config, { maxDiffChars: 100 });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves null (never throws) when fetch rejects', async () => {
    const fetchMock = mockFetch(() => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:9');
    });

    const result = await modelSummarize(DIFF, config);

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
