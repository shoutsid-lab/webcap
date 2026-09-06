import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../../src/db/index.js';
import { makeArtifactRepo } from '../../src/db/artifacts.js';
import type { WebcapConfig } from '../../src/config.js';
import type { CaptureRequest, CaptureResult, PageStructure, StructuredCapture } from '../../src/capture/pipeline.js';
import { CaptureError } from '../../src/capture/errors.js';
import { MIME_BY_FORMAT, extractPage, storeArtifact, type ExtractPageOptions } from '../../src/extract/service.js';

/** Same config shape the watch-scheduler unit tests use (local chain, no model). */
function makeConfig(): WebcapConfig {
  return {
    chain: { name: 'local', rpcUrl: 'http://127.0.0.1:8545', chainId: 31337, usdcContract: '0x0000000000000000000000000000000000000000', explorer: '' },
    chainId: 31337,
    rpcUrl: 'http://127.0.0.1:8545',
    usdcAddress: '0x0000000000000000000000000000000000000000',
    merchantAddress: '0x0000000000000000000000000000000000000001',
    port: 0,
    pollIntervalMs: 5_000,
    merchantPrivateKey: '',
    dbPath: ':memory:',
    x402Network: undefined,
    x402Asset: '0x0000000000000000000000000000000000000000',
    x402PayTo: '0x0000000000000000000000000000000000000001',
    x402PriceUsdcUnits: 1_000,
    x402ExtractPriceUsdcUnits: 10_000,
    computeCostUsdcUnitsPerRequest: 200,
    modelApiBaseUrl: '',
    modelApiKey: '',
    modelName: '',
    x402FacilitatorUrl: 'https://x402.org/facilitator',
    publicBaseUrl: 'http://localhost:8080',
    cdpApiKey: undefined,
  };
}

const STRUCTURE: PageStructure = {
  title: 'Example Domain',
  description: 'For use in examples.',
  headings: [{ level: 1, text: 'Example Domain' }],
  paragraphs: ['p0', 'p1'],
  links: [{ href: 'https://www.iana.org', text: 'More information...' }],
  images: [],
  wordCount: 8,
  markdown: '# Example Domain\n\np0\n\np1',
};

/** Records the request; never touches the network (the model is stubbed separately). */
function makeCaptureStructured(calls: CaptureRequest[], over: Partial<StructuredCapture> = {}): (req: CaptureRequest) => Promise<StructuredCapture> {
  return async (req) => {
    calls.push(req);
    return { html: '<html>page</html>', structure: STRUCTURE, ...over };
  };
}

function makeExtractOptions(over: Partial<ExtractPageOptions> = {}): ExtractPageOptions {
  return {
    url: 'https://example.com/',
    captureStructured: makeCaptureStructured([]),
    schema: undefined,
    model: { baseUrl: '', apiKey: '', model: '' },
    ...over,
  };
}

interface FetchCall {
  readonly url: string;
  readonly init?: RequestInit;
}

/** Wire-level fetch fake, same stubbing style as tests/unit/watch-scheduler.test.ts. */
function makeFetchStub(behavior: (callIndex: number) => Response | Error): {
  readonly calls: FetchCall[];
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
} {
  const calls: FetchCall[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    const outcome = behavior(calls.length - 1);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  return { calls, fetch };
}

describe('extract service (shared orchestration behind /v1/x402/extract + watch extract runs)', () => {
  let db: Db | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('MIME_BY_FORMAT maps every capture format to the content type served for stored artifacts', () => {
    expect(MIME_BY_FORMAT).toEqual({ png: 'image/png', jpeg: 'image/jpeg', pdf: 'application/pdf' });
  });

  it('storeArtifact persists a row the artifact repo reads back and returns the public artifact URL', () => {
    db = openDb(':memory:');
    const repo = makeArtifactRepo(db);
    const bytes = Buffer.from('fake-png-bytes');
    const result: CaptureResult = { buffer: bytes, format: 'png', bytes: bytes.length };

    const url = storeArtifact(repo, makeConfig(), 'https://example.com/', result);

    expect(url).toMatch(/^http:\/\/localhost:8080\/v1\/artifacts\/[0-9a-f-]{36}$/);
    const id = new URL(url).pathname.split('/').pop();
    if (id === undefined) throw new Error('artifact id missing from URL');
    const row = repo.get(id);
    if (row === null) throw new Error('artifact row was not stored');
    expect(row.source_url).toBe('https://example.com/');
    expect(row.format).toBe('png');
    expect(row.mime).toBe('image/png');
    expect(Buffer.compare(row.bytes, bytes)).toBe(0);
  });

  it('extractPage without a schema captures without HTML and returns the bare structure (no model call)', async () => {
    const fetchStub = makeFetchStub(() => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchStub.fetch);
    const calls: CaptureRequest[] = [];
    const data = await extractPage(makeExtractOptions({ captureStructured: makeCaptureStructured(calls) }));

    expect(calls).toEqual([{ url: 'https://example.com/', options: { includeHtml: false } }]);
    expect(fetchStub.calls).toHaveLength(0);
    expect(data).toEqual(STRUCTURE);
    expect('extracted' in data).toBe(false);
  });

  it('extractPage with a schema and a configured model fetches HTML, calls chat/completions, and merges the extracted JSON', async () => {
    const fetchStub = makeFetchStub(() =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ price: 42 }) } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchStub.fetch);
    const calls: CaptureRequest[] = [];
    const data = await extractPage(
      makeExtractOptions({
        captureStructured: makeCaptureStructured(calls),
        schema: 'the price as a number',
        model: { baseUrl: 'https://api.example.com', apiKey: 'test-key', model: 'gpt-test' },
      }),
    );

    expect(calls).toEqual([{ url: 'https://example.com/', options: { includeHtml: true } }]);
    expect(fetchStub.calls).toHaveLength(1);
    const call = fetchStub.calls[0];
    if (call === undefined) throw new Error('no model fetch recorded');
    expect(call.url).toBe('https://api.example.com/chat/completions');
    expect(call.init?.method).toBe('POST');
    expect((call.init?.headers as Record<string, string>)['authorization']).toBe('Bearer test-key');
    const body = JSON.parse(String(call.init?.body)) as { model: string; messages: Array<{ role: string; content: string }> };
    expect(body.model).toBe('gpt-test');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1]?.content).toContain('the price as a number');
    expect(body.messages[1]?.content).toContain('<html>page</html>');
    expect(data).toEqual({ ...STRUCTURE, extracted: { price: 42 } });
  });

  it('extractPage with a schema but no model configured degrades to structure-only (includeHtml false, no fetch)', async () => {
    const fetchStub = makeFetchStub(() => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchStub.fetch);
    const calls: CaptureRequest[] = [];
    const data = await extractPage(
      makeExtractOptions({
        captureStructured: makeCaptureStructured(calls),
        schema: 'the price as a number',
        model: { baseUrl: 'https://api.example.com', apiKey: '', model: 'gpt-test' },
      }),
    );

    expect(calls).toEqual([{ url: 'https://example.com/', options: { includeHtml: false } }]);
    expect(fetchStub.calls).toHaveLength(0);
    expect(data).toEqual(STRUCTURE);
    expect('extracted' in data).toBe(false);
  });

  it('extractPage propagates capture failures unchanged so each caller keeps its own error mapping', async () => {
    const captureError = new CaptureError('structured capture failed for https://example.com/: boom');
    await expect(
      extractPage(makeExtractOptions({ captureStructured: async () => { throw captureError; } })),
    ).rejects.toBe(captureError);

    const plain = new Error('something else blew up');
    await expect(extractPage(makeExtractOptions({ captureStructured: async () => { throw plain; } }))).rejects.toBe(plain);
  });

  it('extractPage forwards the logger: a model failure warns on it and falls back to the bare structure', async () => {
    const fetchStub = makeFetchStub(() => new Error('fetch failed'));
    vi.stubGlobal('fetch', fetchStub.fetch);
    const warn = vi.fn();
    const logger = { info: vi.fn(), warn, error: vi.fn() };
    const data = await extractPage(
      makeExtractOptions({
        schema: 'the price as a number',
        model: { baseUrl: 'https://api.example.com', apiKey: 'test-key', model: 'gpt-test' },
        logger,
      }),
    );

    expect(data).toEqual(STRUCTURE);
    expect('extracted' in data).toBe(false);
    expect(fetchStub.calls).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/webcap model extraction unavailable/);
  });
});
