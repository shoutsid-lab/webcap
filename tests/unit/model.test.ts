import { afterEach, describe, expect, it, vi } from 'vitest';
import { modelExtract, type ModelConfig } from '../../src/extract/model.js';

// Characterization tests: lock the CURRENT behavior of modelExtract (paid-path
// LLM extraction) before the refactor. Every non-happy-path assertion documents
// what the unmodified implementation actually does: a fallback `undefined`
// (caller falls back to deterministic extraction), never a throw.

/** Locked constant from src/extract/model.ts: MAX_HTML_CHARS. */
const MAX_HTML_CHARS = 24_000;

/** Locked from src/extract/model.ts: the fixed system prompt sent with every request. */
const SYSTEM_PROMPT = 'You extract structured data from web pages. Respond with JSON only, no prose.';
const SCHEMA = '{"title": string, "price": number}';

/** Exact fetch init shape model.ts passes; declared here so captured calls stay fully typed. */
interface ModelRequestInit {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly signal: AbortSignal | undefined;
}

const config: ModelConfig = {
  baseUrl: 'http://model.test/v1/', // trailing slash on purpose: model.ts must strip it
  apiKey: 'test-api-key',
  model: 'test-model',
};

function mockFetch(impl: (url: string, init: ModelRequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

type FetchMock = ReturnType<typeof mockFetch>;

function firstCall(fn: FetchMock): [string, ModelRequestInit] {
  const call = fn.mock.calls[0];
  if (call === undefined) throw new Error('fetch was not called');
  return [call[0], call[1]];
}

/** A 200 chat/completions response whose assistant message content is `content`. */
function chatCompletion(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** The exact request body model.ts sends for a given page HTML (locked template). */
function expectedBody(html: string): unknown {
  const userContent = `Extract the following data as a JSON object: ${SCHEMA}\n\n--- PAGE ---\n${html.slice(
    0,
    MAX_HTML_CHARS,
  )}`;
  return {
    model: config.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
  };
}

function spyWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('extract/model (characterization of modelExtract)', () => {
  it('returns the parsed JSON object from the LLM message content (happy path)', async () => {
    const payload = { title: 'Hello', price: 9.5, nested: { a: 1 } };
    const fetchMock = mockFetch(() => chatCompletion(JSON.stringify(payload)));
    const warnSpy = spyWarn();

    const result = await modelExtract('<html><body>page</body></html>', SCHEMA, config);

    expect(result).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('POSTs to <baseUrl without trailing slashes>/chat/completions with Bearer auth and the locked prompts', async () => {
    const html = '<html><body>page</body></html>';
    const fetchMock = mockFetch(() => chatCompletion('{}'));

    await modelExtract(html, SCHEMA, config);

    const [url, init] = firstCall(fetchMock);
    expect(url).toBe('http://model.test/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json', authorization: 'Bearer test-api-key' });
    expect(JSON.parse(init.body)).toEqual(expectedBody(html));
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('truncates HTML above 24_000 chars to the first 24_000 before sending it', async () => {
    const tail = 'TRUNCATED-TAIL';
    const html = 'x'.repeat(MAX_HTML_CHARS) + tail;
    const fetchMock = mockFetch(() => chatCompletion('{}'));

    await modelExtract(html, SCHEMA, config);

    const [, init] = firstCall(fetchMock);
    expect(JSON.parse(init.body)).toEqual(expectedBody(html));
    expect(init.body).not.toContain(tail);
  });

  it('keeps HTML of exactly 24_000 chars intact (truncation boundary)', async () => {
    const html = 'x'.repeat(MAX_HTML_CHARS);
    const fetchMock = mockFetch(() => chatCompletion('{}'));

    await modelExtract(html, SCHEMA, config);

    const [, init] = firstCall(fetchMock);
    expect(JSON.parse(init.body)).toEqual(expectedBody(html));
  });

  const emptyFieldConfigs: [string, ModelConfig][] = [
    ['apiKey', { ...config, apiKey: '' }],
    ['baseUrl', { ...config, baseUrl: '' }],
    ['model', { ...config, model: '' }],
  ];

  it.each(emptyFieldConfigs)('returns undefined without calling fetch when %s is empty', async (_field, emptyConfig) => {
    const fetchMock = mockFetch(() => chatCompletion('{}'));

    const result = await modelExtract('<html/>', SCHEMA, emptyConfig);

    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still calls the model when html is empty (there is no client-side empty-page guard)', async () => {
    const fetchMock = mockFetch(() => chatCompletion('{}'));

    const result = await modelExtract('', SCHEMA, config);

    expect(result).toEqual({});
    const [, init] = firstCall(fetchMock);
    expect(JSON.parse(init.body)).toEqual(expectedBody(''));
  });

  it('returns undefined on a non-2xx LLM status and warns with the HTTP status', async () => {
    const fetchMock = mockFetch(() => new Response('rate limited', { status: 429 }));
    const warnSpy = spyWarn();

    const result = await modelExtract('<html/>', SCHEMA, config);

    expect(result).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('webcap model extraction failed: HTTP 429');
  });

  it('returns undefined when a 2xx body is not valid JSON', async () => {
    const fetchMock = mockFetch(() => new Response('<html>bad gateway</html>', { status: 200 }));
    const warnSpy = spyWarn();

    const result = await modelExtract('<html/>', SCHEMA, config);

    expect(result).toBeUndefined();
    // The exact V8 parse-error message varies across Node versions, so only the prefix is locked.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('webcap model extraction unavailable: '));
  });

  it('returns undefined when fetch rejects (network error), warning with the error message', async () => {
    const fetchMock = mockFetch(() => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:9');
    });
    const warnSpy = spyWarn();

    const result = await modelExtract('<html/>', SCHEMA, config);

    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith('webcap model extraction unavailable: connect ECONNREFUSED 127.0.0.1:9');
  });

  it('returns undefined on timeout: the injected timeoutMs drives the abort signal', async () => {
    // The mock only settles when the passed signal aborts — what a real fetch does —
    // so a missing signal or a mis-wired timeout would fail this test, not hang silently.
    const fetchMock = mockFetch((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init.signal;
        if (signal === undefined) {
          reject(new Error('modelExtract did not pass an abort signal'));
          return;
        }
        signal.addEventListener('abort', () => reject(new Error('This operation was aborted')), { once: true });
      }),
    );
    const warnSpy = spyWarn();

    const startedAt = Date.now();
    const result = await modelExtract('<html/>', SCHEMA, config, 50);
    const elapsedMs = Date.now() - startedAt;

    expect(result).toBeUndefined();
    const [, init] = firstCall(fetchMock);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(warnSpy).toHaveBeenCalledWith('webcap model extraction unavailable: This operation was aborted');
    // The 50ms budget (not the 30s default) had to be honored for this to finish quickly.
    expect(elapsedMs).toBeLessThan(5_000);
  });

  const noContentResponses: [string, string][] = [
    ['top-level is a JSON string', '"hello"'],
    ['top-level is a JSON number', '42'],
    ['top-level is null', 'null'],
    ['choices is an empty array', '{"choices": []}'],
    ['choices key missing', '{}'],
    ['first choice has no message', '{"choices": [{}]}'],
    ['message has no content', '{"choices": [{"message": {}}]}'],
    ['message content is not a string', '{"choices": [{"message": {"content": 42}}]}'],
  ];

  it.each(noContentResponses)('returns undefined when the response has no usable message content: %s', async (_shape, rawBody) => {
    const fetchMock = mockFetch(() => new Response(rawBody, { status: 200, headers: { 'content-type': 'application/json' } }));
    const warnSpy = spyWarn();

    const result = await modelExtract('<html/>', SCHEMA, config);

    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith('webcap model extraction returned no message content');
  });

  const nonObjectContents: [string, string][] = [
    ['a JSON array', '[1, 2, 3]'],
    ['a JSON number', '42'],
    ['JSON null', 'null'],
    ['a JSON string', '"hello"'],
    ['a JSON boolean', 'true'],
  ];

  it.each(nonObjectContents)('returns undefined when the content parses to a non-object: %s', async (_value, content) => {
    const fetchMock = mockFetch(() => chatCompletion(content));
    const warnSpy = spyWarn();

    const result = await modelExtract('<html/>', SCHEMA, config);

    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith('webcap model extraction returned a non-object JSON value');
  });

  it('returns undefined when the content is not JSON (model prose), so the caller falls back to deterministic extraction', async () => {
    const fetchMock = mockFetch(() => chatCompletion('Sure, here is the data: the title is Hello.'));
    const warnSpy = spyWarn();

    const result = await modelExtract('<html/>', SCHEMA, config);

    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith('webcap model extraction returned non-JSON content');
  });
});
