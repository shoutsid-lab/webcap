import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../../src/db/index.js';
import { makeArtifactRepo, type ArtifactRepo } from '../../src/db/artifacts.js';
import { makeRevenueRepo, type RevenueRepo } from '../../src/db/revenue.js';
import { makeWatchRepo, type WatchRepo } from '../../src/watch/store.js';
import { createWatchScheduler, type WatchClock, type WatchPipeline } from '../../src/watch/scheduler.js';
import { stableStringify } from '../../src/watch/diff.js';
import { createWatchAiTokenBudget } from '../../src/extract/modelSummarize.js';
import type { WebcapConfig } from '../../src/config.js';
import type { PageStructure } from '../../src/capture/pipeline.js';

const T0 = Date.parse('2026-06-01T00:00:00.000Z');
const HOUR = 3_600_000;

const BASE_STRUCTURE: PageStructure = {
  title: 'Example Domain',
  description: 'For use in examples.',
  headings: [{ level: 1, text: 'Example Domain' }],
  paragraphs: ['p0', 'p1', 'p2'],
  links: [{ href: 'https://www.iana.org', text: 'More information...' }, { href: 'https://webcap', text: 'webcap' }],
  images: [],
  wordCount: 9,
  markdown: '# Example Domain\n\np0\n\np1\n\np2',
};

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
    x402AuditPriceUsdcUnits: 2_000,
    x402VideoPriceUsdcUnits: 5_000,
    computeCostUsdcUnitsPerRequest: 200,
    modelApiBaseUrl: 'https://model.example.com',
    modelApiKey: 'k',
    modelName: 'm',
    x402FacilitatorUrl: 'https://x402.org/facilitator',
    publicBaseUrl: 'http://localhost:8080',
    cdpApiKey: undefined,
  };
}

interface World {
  readonly db: Db;
  readonly repo: WatchRepo;
  readonly artifacts: ArtifactRepo;
  readonly revenue: RevenueRepo;
  readonly structure: { current: PageStructure };
  readonly config: WebcapConfig;
  close(): void;
}

function makeWorld(): World {
  const db = openDb(':memory:');
  return {
    db,
    repo: makeWatchRepo(db),
    artifacts: makeArtifactRepo(db),
    revenue: makeRevenueRepo(db),
    structure: { current: BASE_STRUCTURE },
    config: makeConfig(),
    close: () => db.close(),
  };
}

function makePipeline(world: World): WatchPipeline {
  return {
    capture: async () => {
      throw new Error('capture is never called for extract-mode watches');
    },
    captureStructured: async () => ({
      html: '<html></html>',
      structure: world.structure.current,
    }),
  };
}

function seedExtractWatch(world: World, id: string): void {
  world.repo.create({
    id,
    url: 'https://example.com/watch',
    every: '1h',
    mode: 'extract',
    schemaJson: null,
    webhookUrl: 'https://webhook.example.com/hook',
    conditionsJson: null,
    channel: 'generic',
    credits: 3,
    nextRunAt: new Date(T0).toISOString(),
    createdAt: new Date(T0).toISOString(),
  });
}

interface FetchCall {
  readonly url: string;
  readonly init?: RequestInit;
}

function summaryResponse(summary: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ index: 0, message: { role: 'assistant', content: summary } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** Routes /chat/completions to the chat behavior; everything else (webhooks) gets a 200. */
function stubRouter(chat: () => Response): { readonly calls: FetchCall[]; chatCalls(): FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    if (url.endsWith('/chat/completions')) return chat();
    return new Response(null, { status: 200 });
  };
  vi.stubGlobal('fetch', fetch);
  return { calls, chatCalls: () => calls.filter((c) => c.url.endsWith('/chat/completions')) };
}

function changedStructure(): PageStructure {
  return { ...BASE_STRUCTURE, paragraphs: ['p0', 'CHANGED', 'p2'] };
}

describe('watch scheduler ai_summary insert (RED)', () => {
  let world: World;

  beforeEach(() => {
    world = makeWorld();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    world.close();
  });

  it('changed run with model configured stores ai_summary; cost stays flat 200/run', async () => {
    const router = stubRouter(() => summaryResponse('Price dropped 20%.'));
    let nowMs = T0 + HOUR;
    const clock: WatchClock = { nowMs: () => nowMs };
    seedExtractWatch(world, 'w');
    const scheduler = createWatchScheduler({
      repo: world.repo,
      pipeline: makePipeline(world),
      artifacts: world.artifacts,
      revenue: world.revenue,
      config: world.config,
      clock,
    });

    await scheduler.tick(); // baseline — unchanged, no summary
    let runs = world.repo.recentRuns('w', 10);
    expect(runs[0]).toMatchObject({ status: 'ok', changed: 0, ai_summary: null });

    world.structure.current = changedStructure();
    nowMs = T0 + 2 * HOUR;
    await scheduler.tick(); // changed — summary stored, alert still delivered

    runs = world.repo.recentRuns('w', 10);
    expect(runs[0]).toMatchObject({ status: 'ok', changed: 1, ai_summary: 'Price dropped 20%.', webhook: 'ok: HTTP 200' });
    expect(router.chatCalls()).toHaveLength(1);
    const ledger = world.revenue.recent(5);
    expect(ledger).toHaveLength(2);
    for (const entry of ledger) {
      expect(entry).toMatchObject({ endpoint: 'watch-extract', payer: 'scheduler', revenue_usdc: 0, cost_usdc: 200 });
    }
  });

  it('summarizer failure/timeout resolves null: status stays ok, alert still built+delivered', async () => {
    const router = stubRouter(() => new Response('bad request', { status: 400 }));
    let nowMs = T0 + HOUR;
    const clock: WatchClock = { nowMs: () => nowMs };
    seedExtractWatch(world, 'w');
    const scheduler = createWatchScheduler({
      repo: world.repo,
      pipeline: makePipeline(world),
      artifacts: world.artifacts,
      revenue: world.revenue,
      config: world.config,
      clock,
    });

    await scheduler.tick(); // baseline
    world.structure.current = changedStructure();
    nowMs = T0 + 2 * HOUR;
    await scheduler.tick(); // changed — summarizer 400s, still ok + alerted

    const runs = world.repo.recentRuns('w', 10);
    expect(runs[0]).toMatchObject({ status: 'ok', changed: 1, ai_summary: null, webhook: 'ok: HTTP 200' });
    expect(router.chatCalls()).toHaveLength(1); // fail-open, no retry storm on a terminal 400
  });

  it('over-budget resolves null without fetching: status stays ok, alert still built+delivered', async () => {
    const router = stubRouter(() => summaryResponse('must never be called'));
    let nowMs = T0 + HOUR;
    const clock: WatchClock = { nowMs: () => nowMs };
    seedExtractWatch(world, 'w');
    const scheduler = createWatchScheduler({
      repo: world.repo,
      pipeline: makePipeline(world),
      artifacts: world.artifacts,
      revenue: world.revenue,
      config: world.config,
      clock,
      aiBudget: createWatchAiTokenBudget({ maxTokensPerRun: 0, maxTokensGlobalWindow: 0 }),
    });

    await scheduler.tick(); // baseline
    world.structure.current = changedStructure();
    nowMs = T0 + 2 * HOUR;
    await scheduler.tick(); // changed — gated, no fetch, still ok + alerted

    const runs = world.repo.recentRuns('w', 10);
    expect(runs[0]).toMatchObject({ status: 'ok', changed: 1, ai_summary: null, webhook: 'ok: HTTP 200' });
    expect(router.chatCalls()).toHaveLength(0);
    expect(stableStringify(changedStructure())).toContain('CHANGED'); // sanity: the diff was real
  });
});
