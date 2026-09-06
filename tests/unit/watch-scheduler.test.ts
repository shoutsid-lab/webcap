import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../../src/db/index.js';
import { makeArtifactRepo, type ArtifactRepo } from '../../src/db/artifacts.js';
import { makeRevenueRepo, type RevenueRepo } from '../../src/db/revenue.js';
import { makeWatchRepo, type WatchRepo, type WatchRow } from '../../src/watch/store.js';
import { createWatchScheduler, type WatchClock, type WatchPipeline } from '../../src/watch/scheduler.js';
import { createServer } from 'node:http';
import { sha256Hex, stableStringify } from '../../src/watch/diff.js';
import type { WebcapConfig } from '../../src/config.js';
import type { ServiceLogger } from '../../src/util/logger.js';
import type { PageStructure } from '../../src/capture/pipeline.js';

const T0 = Date.parse('2026-06-01T00:00:00.000Z');
const HOUR = 3_600_000;

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
    computeCostUsdcUnitsPerRequest: 200,
    modelApiBaseUrl: '',
    modelApiKey: '',
    modelName: '',
    x402FacilitatorUrl: 'https://x402.org/facilitator',
    publicBaseUrl: 'http://localhost:8080',
    cdpApiKey: undefined,
  };
}

interface FakeClock {
  readonly clock: WatchClock;
  nowMs(): number;
  advance(ms: number): void;
}

function makeFakeClock(startMs: number): FakeClock {
  let t = startMs;
  return {
    clock: { nowMs: () => t },
    nowMs: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

interface HangGate {
  readonly promise: Promise<void>;
  release(): void;
}

function makeHangGate(): HangGate {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release() { release(); } };
}

interface PipelineState {
  captureBytes: Buffer;
  structure: PageStructure;
  failCount: number;
  gate: HangGate | null;
  captureCalls: number;
  structureCalls: number;
}

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

function makePipeline(state: PipelineState): WatchPipeline {
  return {
    capture: async (req) => {
      state.captureCalls += 1;
      if (state.gate !== null) await state.gate.promise;
      if (state.failCount > 0) {
        state.failCount -= 1;
        throw new Error(`capture failed for ${req.url}`);
      }
      return { buffer: state.captureBytes, format: 'png', bytes: state.captureBytes.length };
    },
    captureStructured: async (req) => {
      state.structureCalls += 1;
      if (state.gate !== null) await state.gate.promise;
      if (state.failCount > 0) {
        state.failCount -= 1;
        throw new Error(`structured capture failed for ${req.url}`);
      }
      return { html: '<html></html>', structure: state.structure };
    },
  };
}

interface World {
  readonly db: Db;
  readonly repo: WatchRepo;
  readonly artifacts: ArtifactRepo;
  readonly revenue: RevenueRepo;
  readonly state: PipelineState;
  readonly config: WebcapConfig;
  close(): void;
}

function makeWorld(): World {
  const db = openDb(':memory:');
  const state: PipelineState = {
    captureBytes: Buffer.from('v1'),
    structure: BASE_STRUCTURE,
    failCount: 0,
    gate: null,
    captureCalls: 0,
    structureCalls: 0,
  };
  return {
    db,
    repo: makeWatchRepo(db),
    artifacts: makeArtifactRepo(db),
    revenue: makeRevenueRepo(db),
    state,
    config: makeConfig(),
    close: () => db.close(),
  };
}

function seedWatch(
  repo: WatchRepo,
  over: {
    readonly id?: string;
    readonly every?: string;
    readonly mode?: 'capture' | 'extract';
    readonly schemaJson?: string | null;
    readonly webhookUrl?: string | null;
    readonly credits?: number;
    readonly nextRunAt?: string | null;
  } = {},
): WatchRow {
  const id = over.id ?? crypto.randomUUID();
  repo.create({
    id,
    url: 'https://example.com/watch',
    every: over.every ?? '1h',
    mode: over.mode ?? 'capture',
    schemaJson: over.schemaJson ?? null,
    webhookUrl: over.webhookUrl ?? null,
    credits: over.credits ?? 5,
    nextRunAt: over.nextRunAt ?? new Date(T0 + HOUR).toISOString(),
    createdAt: new Date(T0).toISOString(),
  });
  const row = repo.get(id);
  if (row === null) throw new Error('watch vanished after insert');
  return row;
}

function makeScheduler(world: World, clock: WatchClock) {
  return createWatchScheduler({
    repo: world.repo,
    pipeline: makePipeline(world.state),
    artifacts: world.artifacts,
    revenue: world.revenue,
    config: world.config,
    clock,
  });
}

interface FetchCall {
  readonly url: string;
  readonly init?: RequestInit;
}

/**
 * Wire-level fetch fake: records every call and plays back a fixed behavior.
 * Installed on globalThis via vi.stubGlobal so the scheduler's bare `fetch`
 * resolves to it; the webhook fire-time guard is what decides whether any
 * call is made at all.
 */
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

describe('watch scheduler (injected clock, no real waiting)', () => {
  let world: World;

  beforeEach(() => {
    world = makeWorld();
  });

  afterEach(() => {
    world.close();
  });

  it('runs a due watch on tick and leaves a not-due watch untouched', async () => {
    const clock = makeFakeClock(T0 + HOUR); // exactly at the due instant
    seedWatch(world.repo, { id: 'due', nextRunAt: new Date(T0 + HOUR).toISOString(), credits: 5 });
    seedWatch(world.repo, { id: 'later', nextRunAt: new Date(T0 + 2 * HOUR).toISOString(), credits: 5 });
    await makeScheduler(world, clock.clock).tick();

    expect(world.state.captureCalls).toBe(1);
    const dueRow = world.repo.get('due');
    if (dueRow === null) throw new Error('due watch vanished');
    expect(dueRow.credits).toBe(4);
    expect(dueRow.last_run_at).toBe(new Date(clock.nowMs()).toISOString());
    expect(dueRow.next_run_at).toBe(new Date(clock.nowMs() + HOUR).toISOString());
    const laterRow = world.repo.get('later');
    if (laterRow === null) throw new Error('later watch vanished');
    expect(laterRow.credits).toBe(5);
    expect(laterRow.last_run_at).toBeNull();
    expect(world.repo.recentRuns('later', 10)).toHaveLength(0);
  });

  it('advances next_run_at by the configured interval and sets last_run_at', async () => {
    const at = T0 + 5 * 60_000;
    const clock = makeFakeClock(at);
    seedWatch(world.repo, { id: 'w', every: '15m', nextRunAt: new Date(T0).toISOString(), credits: 2 });
    await makeScheduler(world, clock.clock).tick();
    const row = world.repo.get('w');
    if (row === null) throw new Error('watch vanished');
    expect(row.last_run_at).toBe(new Date(at).toISOString());
    expect(row.next_run_at).toBe(new Date(at + 15 * 60_000).toISOString());
  });

  it('single-flight: a running watch never double-runs (a second tick skips it)', async () => {
    const clock = makeFakeClock(T0 + HOUR);
    const gate = makeHangGate();
    world.state.gate = gate;
    seedWatch(world.repo, { id: 'w', nextRunAt: new Date(T0).toISOString(), credits: 3 });
    const scheduler = makeScheduler(world, clock.clock);

    const first = scheduler.tick(); // starts the run; it hangs on the gate
    await scheduler.tick(); // must not start a second run of the same watch
    gate.release();
    await first;

    expect(world.state.captureCalls).toBe(1);
    expect(world.repo.recentRuns('w', 10)).toHaveLength(1);
  });

  it('boot recovery: an overdue persisted watch runs on the first tick of a fresh scheduler', async () => {
    seedWatch(world.repo, { id: 'old', nextRunAt: '2026-01-01T00:00:00.000Z', credits: 1 });
    const clock = makeFakeClock(T0); // far after next_run_at
    await makeScheduler(world, clock.clock).tick();
    const row = world.repo.get('old');
    if (row === null) throw new Error('watch vanished');
    expect(row.credits).toBe(0);
    expect(row.next_run_at).toBe(new Date(T0 + HOUR).toISOString());
    expect(world.repo.recentRuns('old', 10).map((r) => r.status)).toEqual(['ok']);
  });

  it('an ok run consumes 1 credit and accounts the cost to the ledger (revenue 0)', async () => {
    const clock = makeFakeClock(T0 + HOUR);
    seedWatch(world.repo, { id: 'w', nextRunAt: new Date(T0).toISOString(), credits: 2 });
    await makeScheduler(world, clock.clock).tick();
    const row = world.repo.get('w');
    if (row === null) throw new Error('watch vanished');
    expect(row.credits).toBe(1);
    const ledger = world.revenue.recent(5);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      endpoint: 'watch-capture',
      payer: 'scheduler',
      revenue_usdc: 0,
      cost_usdc: world.config.computeCostUsdcUnitsPerRequest,
    });
  });

  it('an error run consumes 1 credit, is recorded as error, and still advances the schedule', async () => {
    world.state.failCount = 1;
    const clock = makeFakeClock(T0 + HOUR);
    seedWatch(world.repo, { id: 'w', nextRunAt: new Date(T0).toISOString(), credits: 2 });
    await makeScheduler(world, clock.clock).tick();
    const row = world.repo.get('w');
    if (row === null) throw new Error('watch vanished');
    expect(row.credits).toBe(1);
    expect(row.next_run_at).toBe(new Date(T0 + 2 * HOUR).toISOString());
    const runs = world.repo.recentRuns('w', 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('error');
    expect(runs[0]?.error).toMatch(/capture failed/);
    expect(runs[0]?.changed).toBe(0);
  });

  it('a 0-credit run is recorded as no-credit, pauses the watch, executes nothing', async () => {
    const clock = makeFakeClock(T0 + HOUR);
    seedWatch(world.repo, { id: 'w', nextRunAt: new Date(T0).toISOString(), credits: 0 });
    await makeScheduler(world, clock.clock).tick();
    const row = world.repo.get('w');
    if (row === null) throw new Error('watch vanished');
    expect(row.credits).toBe(0); // nothing consumed
    expect(row.paused).toBe(1);
    expect(row.next_run_at).toBe(new Date(T0).toISOString()); // unchanged
    expect(row.last_run_at).toBeNull(); // no executed run
    expect(world.state.captureCalls).toBe(0);
    expect(world.revenue.recent(5)).toHaveLength(0); // no cost for a run that never executed
    const runs = world.repo.recentRuns('w', 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('no-credit');
  });

  it('a top-up after a no-credit pause resumes the watch (credits += 100, paused 0, next_run_at rescheduled)', async () => {
    const clock = makeFakeClock(T0 + HOUR);
    const watch = seedWatch(world.repo, { id: 'w', nextRunAt: new Date(T0).toISOString(), credits: 0 });
    const scheduler = makeScheduler(world, clock.clock);
    await scheduler.tick(); // no-credit + paused

    const topUpAt = T0 + 2 * HOUR;
    const credits = world.repo.topUp(watch.id, 100, new Date(topUpAt).toISOString());
    expect(credits).toBe(100);
    const resumed = world.repo.get(watch.id);
    if (resumed === null) throw new Error('watch vanished');
    expect(resumed.paused).toBe(0);
    expect(resumed.next_run_at).toBe(new Date(topUpAt).toISOString());

    clock.advance(HOUR); // now past the rescheduled next_run_at
    await scheduler.tick();
    const after = world.repo.get(watch.id);
    if (after === null) throw new Error('watch vanished');
    expect(after.credits).toBe(99);
    expect(after.last_run_at).not.toBeNull();
  });

  it('topUp on an unknown watch returns null and changes nothing', () => {
    expect(world.repo.topUp('does-not-exist', 100, new Date(T0).toISOString())).toBeNull();
  });
});

describe('watch scheduler change detection', () => {
  let world: World;

  beforeEach(() => {
    world = makeWorld();
  });

  afterEach(() => {
    world.close();
  });

  it('capture: first run is the baseline (changed=false); a byte change flips to changed; stable again after', async () => {
    const clock = makeFakeClock(T0 + HOUR);
    seedWatch(world.repo, { id: 'w', nextRunAt: new Date(T0).toISOString(), credits: 3 });
    const scheduler = makeScheduler(world, clock.clock);

    await scheduler.tick();
    let runs = world.repo.recentRuns('w', 10);
    expect(runs[0]).toMatchObject({ status: 'ok', changed: 0 });
    let row = world.repo.get('w');
    if (row === null) throw new Error('watch vanished');
    expect(row.baseline_hash).toBe(sha256Hex(Buffer.from('v1')));
    expect(runs[0]?.artifact_url).toMatch(/^http:\/\/localhost:8080\/v1\/artifacts\/[0-9a-f-]{36}$/);
    // The artifact bytes are persisted and served.
    const artifactId = new URL(runs[0]?.artifact_url ?? 'http://localhost:8080/').pathname.split('/').pop();
    const stored = artifactId !== undefined ? world.artifacts.get(artifactId) : null;
    if (stored === null) throw new Error('artifact was not stored');
    expect(Buffer.compare(stored.bytes, Buffer.from('v1'))).toBe(0);

    world.state.captureBytes = Buffer.from('v2');
    clock.advance(HOUR);
    await scheduler.tick();
    runs = world.repo.recentRuns('w', 10);
    expect(runs[0]).toMatchObject({ status: 'ok', changed: 1, diff_summary: 'artifact' });
    row = world.repo.get('w');
    if (row === null) throw new Error('watch vanished');
    expect(row.baseline_hash).toBe(sha256Hex(Buffer.from('v2')));

    clock.advance(HOUR);
    await scheduler.tick();
    runs = world.repo.recentRuns('w', 10);
    expect(runs[0]).toMatchObject({ status: 'ok', changed: 0 });
  });

  it('extract: first run is the baseline; nested + array field diffs are summarized; unchanged stays false', async () => {
    const clock = makeFakeClock(T0 + HOUR);
    seedWatch(world.repo, {
      id: 'w',
      mode: 'extract',
      schemaJson: null,
      nextRunAt: new Date(T0).toISOString(),
      credits: 3,
    });
    const scheduler = makeScheduler(world, clock.clock);

    await scheduler.tick();
    let runs = world.repo.recentRuns('w', 10);
    expect(runs[0]).toMatchObject({ status: 'ok', changed: 0 });
    let row = world.repo.get('w');
    if (row === null) throw new Error('watch vanished');
    expect(row.baseline_json).toBe(stableStringify(BASE_STRUCTURE));
    expect(world.state.structureCalls).toBe(1);

    const changed: PageStructure = {
      ...BASE_STRUCTURE,
      title: 'Example Domain (edited)',
      paragraphs: ['p0', 'CHANGED', 'p2'],
      links: [{ href: 'CHANGED', text: 'More information...' }, { href: 'https://webcap', text: 'webcap' }],
    };
    world.state.structure = changed;
    clock.advance(HOUR);
    await scheduler.tick();
    runs = world.repo.recentRuns('w', 10);
    expect(runs[0]).toMatchObject({ status: 'ok', changed: 1, diff_summary: 'links[0].href, paragraphs[1], title' });
    expect(runs[0]?.extract_json).toBe(stableStringify(changed));
    row = world.repo.get('w');
    if (row === null) throw new Error('watch vanished');
    expect(row.baseline_json).toBe(stableStringify(changed));

    clock.advance(HOUR);
    await scheduler.tick();
    runs = world.repo.recentRuns('w', 10);
    expect(runs[0]).toMatchObject({ status: 'ok', changed: 0 });
  });
});

describe('watch scheduler webhook alerts', () => {
  let world: World;

  beforeEach(() => {
    world = makeWorld();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    world.close();
  });

  it('fires a public https webhook with the documented payload on a changed run; not on unchanged runs', async () => {
    const stub = makeFetchStub(() => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', stub.fetch);
    const clock = makeFakeClock(T0 + HOUR);
    seedWatch(world.repo, {
      id: 'w',
      webhookUrl: 'https://webhook.example.com/hook',
      nextRunAt: new Date(T0).toISOString(),
      credits: 3,
    });
    const scheduler = makeScheduler(world, clock.clock);

    await scheduler.tick(); // baseline run — unchanged
    expect(stub.calls).toHaveLength(0);

    world.state.captureBytes = Buffer.from('v2');
    clock.advance(HOUR);
    await scheduler.tick(); // changed run — exactly one delivery, exact wire parity
    expect(stub.calls).toHaveLength(1);
    const call = stub.calls[0];
    if (call === undefined) throw new Error('no webhook fetch recorded');
    expect(call.url).toBe('https://webhook.example.com/hook');
    expect(call.init?.method).toBe('POST');
    expect(call.init?.headers).toEqual({ 'content-type': 'application/json' });
    expect(call.init?.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(call.init?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      watchId: 'w',
      url: 'https://example.com/watch',
      mode: 'capture',
      changed: true,
      diffSummary: 'artifact',
      artifactUrl: expect.stringMatching(/^http:\/\/localhost:8080\/v1\/artifacts\/[0-9a-f-]{36}$/),
      at: new Date(T0 + 2 * HOUR).toISOString(),
    });
    const runs = world.repo.recentRuns('w', 10);
    expect(runs[0]).toMatchObject({ status: 'ok', changed: 1, webhook: 'ok: HTTP 200' });
    expect(scheduler.stats().webhooksSkipped).toBe(0);

    clock.advance(HOUR);
    await scheduler.tick(); // unchanged again — no alert
    expect(stub.calls).toHaveLength(1);
  });

  it('a failing webhook does not fail the run (status stays ok, 3 attempts, outcome on the run record)', async () => {
    const stub = makeFetchStub(() => new Error('fetch failed'));
    vi.stubGlobal('fetch', stub.fetch);
    const clock = makeFakeClock(T0 + HOUR);
    seedWatch(world.repo, {
      id: 'w',
      webhookUrl: 'https://webhook.example.com/hook',
      nextRunAt: new Date(T0).toISOString(),
      credits: 2,
    });
    const scheduler = makeScheduler(world, clock.clock);

    await scheduler.tick(); // baseline (unchanged) — no webhook
    world.state.captureBytes = Buffer.from('v2');
    clock.advance(HOUR);
    await scheduler.tick(); // changed — webhook keeps failing

    expect(stub.calls).toHaveLength(3); // retry parity: all attempts, then give up
    const runs = world.repo.recentRuns('w', 10);
    expect(runs[0]).toMatchObject({ status: 'ok', changed: 1 });
    expect(runs[0]?.webhook).toBe('failed: fetch failed');
    expect(scheduler.stats().webhooksSkipped).toBe(0);
    const row = world.repo.get('w');
    if (row === null) throw new Error('watch vanished');
    expect(row.credits).toBe(0); // both runs consumed; the alert never failed the run
  });

  it('skips a loopback webhook_url at fire time: no fetch, run says skipped, counter +1, log line', async () => {
    const stub = makeFetchStub(() => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', stub.fetch);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const clock = makeFakeClock(T0 + HOUR);
    seedWatch(world.repo, {
      id: 'w',
      webhookUrl: 'http://127.0.0.1:9999/hook',
      nextRunAt: new Date(T0).toISOString(),
      credits: 2,
    });
    const scheduler = makeScheduler(world, clock.clock);

    await scheduler.tick(); // baseline (unchanged) — no webhook at all
    world.state.captureBytes = Buffer.from('v2');
    clock.advance(HOUR);
    await scheduler.tick(); // changed — but the stored URL is loopback

    expect(stub.calls).toHaveLength(0); // no request leaves the process
    const runs = world.repo.recentRuns('w', 10);
    expect(runs[0]).toMatchObject({ status: 'ok', changed: 1 });
    expect(runs[0]?.webhook).toBe('skipped: capture host is not allowed: 127.0.0.1');
    expect(scheduler.stats().webhooksSkipped).toBe(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const args = warnSpy.mock.calls[0];
    if (args === undefined) throw new Error('expected a structured warn log line');
    expect(args[0]).toContain('webhook delivery skipped');
    expect(args[1]).toMatchObject({ watchId: 'w', webhookUrl: 'http://127.0.0.1:9999/hook' });
  });

  it('skips a cloud-metadata webhook_url (169.254.169.254) at fire time: no fetch, counter +1', async () => {
    const stub = makeFetchStub(() => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', stub.fetch);
    const clock = makeFakeClock(T0 + HOUR);
    seedWatch(world.repo, {
      id: 'w',
      webhookUrl: 'http://169.254.169.254/latest/meta-data/',
      nextRunAt: new Date(T0).toISOString(),
      credits: 2,
    });
    const scheduler = makeScheduler(world, clock.clock);

    await scheduler.tick(); // baseline
    world.state.captureBytes = Buffer.from('v2');
    clock.advance(HOUR);
    await scheduler.tick(); // changed — but the stored URL is cloud metadata

    expect(stub.calls).toHaveLength(0);
    const runs = world.repo.recentRuns('w', 10);
    expect(runs[0]).toMatchObject({ status: 'ok', changed: 1 });
    expect(runs[0]?.webhook).toBe('skipped: capture host is not allowed: 169.254.169.254');
    expect(scheduler.stats().webhooksSkipped).toBe(1);
  });

  it('skips a private-range webhook_url (10.0.0.5) at fire time: no fetch, counter +1', async () => {
    const stub = makeFetchStub(() => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', stub.fetch);
    const clock = makeFakeClock(T0 + HOUR);
    seedWatch(world.repo, {
      id: 'w',
      webhookUrl: 'http://10.0.0.5/hook',
      nextRunAt: new Date(T0).toISOString(),
      credits: 2,
    });
    const scheduler = makeScheduler(world, clock.clock);

    await scheduler.tick(); // baseline
    world.state.captureBytes = Buffer.from('v2');
    clock.advance(HOUR);
    await scheduler.tick(); // changed — but the stored URL is a private range

    expect(stub.calls).toHaveLength(0);
    const runs = world.repo.recentRuns('w', 10);
    expect(runs[0]).toMatchObject({ status: 'ok', changed: 1 });
    expect(runs[0]?.webhook).toBe('skipped: capture host is not allowed: 10.0.0.5');
    expect(scheduler.stats().webhooksSkipped).toBe(1);
  });

  it('skips a non-https public webhook_url at fire time (https required): no fetch, counter +1', async () => {
    const stub = makeFetchStub(() => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', stub.fetch);
    const clock = makeFakeClock(T0 + HOUR);
    seedWatch(world.repo, {
      id: 'w',
      webhookUrl: 'http://public.example.com/hook',
      nextRunAt: new Date(T0).toISOString(),
      credits: 2,
    });
    const scheduler = makeScheduler(world, clock.clock);

    await scheduler.tick(); // baseline
    world.state.captureBytes = Buffer.from('v2');
    clock.advance(HOUR);
    await scheduler.tick(); // changed — public host, but plain http

    expect(stub.calls).toHaveLength(0);
    const runs = world.repo.recentRuns('w', 10);
    expect(runs[0]).toMatchObject({ status: 'ok', changed: 1 });
    expect(runs[0]?.webhook).toBe('skipped: webhook must be https');
    expect(scheduler.stats().webhooksSkipped).toBe(1);
  });

  it('the skipped counter accumulates across ticks (2 changed runs with a blocked URL -> webhooksSkipped 2)', async () => {
    const stub = makeFetchStub(() => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', stub.fetch);
    const clock = makeFakeClock(T0 + HOUR);
    seedWatch(world.repo, {
      id: 'w',
      webhookUrl: 'http://127.0.0.1:9999/hook',
      nextRunAt: new Date(T0).toISOString(),
      credits: 3,
    });
    const scheduler = makeScheduler(world, clock.clock);

    await scheduler.tick(); // baseline
    world.state.captureBytes = Buffer.from('v2');
    clock.advance(HOUR);
    await scheduler.tick(); // skip #1
    world.state.captureBytes = Buffer.from('v3');
    clock.advance(HOUR);
    await scheduler.tick(); // skip #2

    expect(stub.calls).toHaveLength(0);
    expect(scheduler.stats().webhooksSkipped).toBe(2);
  });
});

const SILENT_LOGGER: ServiceLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Extract-mode pipeline for these tests: artifact capture is never expected;
 * the structured capture hands the model a page (html) only when the caller
 * opts into includeHtml — which the model path must do to have anything to parse.
 */
function makeExtractPipeline(): WatchPipeline {
  return {
    capture: async () => {
      throw new Error('capture is never called for extract-mode watches');
    },
    captureStructured: async (req) => ({
      html: req.options?.includeHtml === true ? '<html>x</html>' : '',
      structure: BASE_STRUCTURE,
    }),
  };
}

interface ModelServerHandle {
  readonly baseUrl: string;
  close(): Promise<void>;
}

/**
 * A real local OpenAI-compatible model endpoint on an ephemeral port: answers
 * POST /chat/completions with a fixed completion after replyDelayMs. A fetch
 * stub cannot honor AbortSignal, so only a live server exercises the
 * production abort path in modelExtract.
 */
function startModelServer(replyDelayMs: number): Promise<ModelServerHandle> {
  const completion = JSON.stringify({
    choices: [{ index: 0, message: { role: 'assistant', content: '{"a":"x"}' } }],
  });
  const server = createServer((req, res) => {
    req.resume(); // drain the request body
    setTimeout(
      () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(completion);
      },
      replyDelayMs,
    ).unref(); // a late reply must never hold the test process open
  });
  server.keepAliveTimeout = 0;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        reject(new Error('model server did not bind a TCP port'));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.closeAllConnections();
            server.close((err) => {
              if (err === undefined) resolveClose();
              else rejectClose(err);
            });
          }),
      });
    });
  });
}

describe('watch scheduler extract model timeout (real local model server)', () => {
  let world: World;
  let modelServer: ModelServerHandle | undefined;

  beforeEach(() => {
    world = makeWorld();
  });

  afterEach(async () => {
    await modelServer?.close();
    modelServer = undefined;
    world.close();
  });

  it('a slow model call aborts at config.modelTimeoutMs and the run stays ok, structure-only', async () => {
    modelServer = await startModelServer(1_500);
    const clock = makeFakeClock(T0 + HOUR);
    seedWatch(world.repo, {
      id: 'w',
      mode: 'extract',
      schemaJson: '{"a":"string"}',
      nextRunAt: new Date(T0).toISOString(),
      credits: 2,
    });
    const scheduler = createWatchScheduler({
      repo: world.repo,
      pipeline: makeExtractPipeline(),
      artifacts: world.artifacts,
      revenue: world.revenue,
      config: {
        ...world.config,
        modelApiBaseUrl: modelServer.baseUrl,
        modelApiKey: 'k',
        modelName: 'm',
        modelTimeoutMs: 300,
      },
      clock: clock.clock,
      logger: SILENT_LOGGER,
    });

    const startedAt = Date.now();
    await scheduler.tick();
    const elapsedMs = Date.now() - startedAt;

    const runs = world.repo.recentRuns('w', 10);
    expect(runs).toHaveLength(1);
    const run = runs[0];
    if (run === undefined) throw new Error('run vanished');
    expect(run.status).toBe('ok');
    const extractJson = run.extract_json;
    if (extractJson === null) throw new Error('extract run recorded no extract_json');
    const extract = JSON.parse(extractJson) as Record<string, unknown>;
    expect(extract).not.toHaveProperty('extracted');
    expect(extractJson).toBe(stableStringify(BASE_STRUCTURE));
    expect(elapsedMs).toBeLessThan(1_500);
  });

  it('a model call that fits the configured timeout completes with extracted data', async () => {
    modelServer = await startModelServer(100);
    const clock = makeFakeClock(T0 + HOUR);
    seedWatch(world.repo, {
      id: 'w',
      mode: 'extract',
      schemaJson: '{"a":"string"}',
      nextRunAt: new Date(T0).toISOString(),
      credits: 2,
    });
    const scheduler = createWatchScheduler({
      repo: world.repo,
      pipeline: makeExtractPipeline(),
      artifacts: world.artifacts,
      revenue: world.revenue,
      config: {
        ...world.config,
        modelApiBaseUrl: modelServer.baseUrl,
        modelApiKey: 'k',
        modelName: 'm',
        modelTimeoutMs: 5_000,
      },
      clock: clock.clock,
      logger: SILENT_LOGGER,
    });

    await scheduler.tick();

    const runs = world.repo.recentRuns('w', 10);
    expect(runs).toHaveLength(1);
    const run = runs[0];
    if (run === undefined) throw new Error('run vanished');
    expect(run.status).toBe('ok');
    const extractJson = run.extract_json;
    if (extractJson === null) throw new Error('extract run recorded no extract_json');
    const extract = JSON.parse(extractJson) as Record<string, unknown>;
    expect(extract).toHaveProperty('extracted', { a: 'x' });
  });
});

describe('watch scheduler conditions gating + channel dispatch (T4-S1/S2)', () => {
  let world: World;

  beforeEach(() => {
    world = makeWorld();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    world.close();
  });

  function seedConditional(
    over: {
      readonly id?: string;
      readonly conditions?: unknown;
      readonly channel?: string;
      readonly credits?: number;
    } = {},
  ): string {
    const id = over.id ?? crypto.randomUUID();
    world.repo.create({
      id,
      url: 'https://example.com/watch',
      every: '1h',
      mode: 'extract',
      schemaJson: null,
      webhookUrl: 'https://webhook.example.com/hook',
      credits: over.credits ?? 3,
      nextRunAt: new Date(T0).toISOString(),
      createdAt: new Date(T0).toISOString(),
      conditionsJson: over.conditions === undefined ? null : JSON.stringify(over.conditions),
      channel: (over.channel ?? 'generic') as 'generic' | 'slack' | 'discord',
    });
    return id;
  }

  function changedStructure(): PageStructure {
    return { ...BASE_STRUCTURE, paragraphs: ['p0', 'CHANGED', 'p2'] };
  }

  it('persists conditions_json + channel on the watch row (existing rows stay valid)', () => {
    const id = seedConditional({
      conditions: [{ type: 'keyword', keyword: 'Example' }],
      channel: 'slack',
    });
    const row = world.repo.get(id);
    expect(row).toMatchObject({
      conditions_json: JSON.stringify([{ type: 'keyword', keyword: 'Example' }]),
      channel: 'slack',
    });
    const legacyId = seedConditional();
    expect(world.repo.get(legacyId)).toMatchObject({ conditions_json: null, channel: 'generic' });
  });

  it('changed AND conditions match -> webhook fires; baseline (unchanged) never fires', async () => {
    const stub = makeFetchStub(() => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', stub.fetch);
    const clock = makeFakeClock(T0 + HOUR);
    seedConditional({ id: 'w', conditions: [{ type: 'keyword', keyword: 'example' }] });
    const scheduler = makeScheduler(world, clock.clock);

    await scheduler.tick(); // baseline run — unchanged, no alert even though the keyword matches
    expect(stub.calls).toHaveLength(0);

    world.state.structure = changedStructure();
    clock.advance(HOUR);
    await scheduler.tick(); // changed + keyword matches markdown -> fires
    expect(stub.calls).toHaveLength(1);
    const runs = world.repo.recentRuns('w', 10);
    expect(runs[0]).toMatchObject({ status: 'ok', changed: 1, webhook: 'ok: HTTP 200' });
  });

  it('changed but conditions unmet -> no webhook (run stays changed, webhook null)', async () => {
    const stub = makeFetchStub(() => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', stub.fetch);
    const clock = makeFakeClock(T0 + HOUR);
    seedConditional({ id: 'w', conditions: [{ type: 'keyword', keyword: 'no-such-phrase-xyz' }] });
    const scheduler = makeScheduler(world, clock.clock);

    await scheduler.tick(); // baseline
    world.state.structure = changedStructure();
    clock.advance(HOUR);
    await scheduler.tick(); // changed, but the keyword is absent -> gated

    expect(stub.calls).toHaveLength(0);
    const runs = world.repo.recentRuns('w', 10);
    expect(runs[0]).toMatchObject({ status: 'ok', changed: 1, webhook: null });
    expect(scheduler.stats().webhooksSkipped).toBe(0);
  });

  it('no conditions = legacy changed-only: generic payload stays byte-identical', async () => {
    const stub = makeFetchStub(() => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', stub.fetch);
    const clock = makeFakeClock(T0 + HOUR);
    seedConditional({ id: 'w' });
    const scheduler = makeScheduler(world, clock.clock);

    await scheduler.tick();
    world.state.structure = changedStructure();
    clock.advance(HOUR);
    await scheduler.tick();

    expect(stub.calls).toHaveLength(1);
    const body = JSON.parse(String(stub.calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      watchId: 'w',
      url: 'https://example.com/watch',
      mode: 'extract',
      changed: true,
      diffSummary: 'paragraphs[1]',
      extract: JSON.parse(stableStringify(changedStructure())),
      at: new Date(T0 + 2 * HOUR).toISOString(),
    });
  });

  it("slack channel delivers a Block Kit payload (not the generic shape)", async () => {
    const stub = makeFetchStub(() => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', stub.fetch);
    const clock = makeFakeClock(T0 + HOUR);
    seedConditional({ id: 'w', conditions: [{ type: 'keyword', keyword: 'example' }], channel: 'slack' });
    const scheduler = makeScheduler(world, clock.clock);

    await scheduler.tick();
    world.state.structure = changedStructure();
    clock.advance(HOUR);
    await scheduler.tick();

    expect(stub.calls).toHaveLength(1);
    const body = JSON.parse(String(stub.calls[0]?.init?.body)) as Record<string, unknown>;
    expect(typeof body['text']).toBe('string');
    expect(Array.isArray(body['blocks'])).toBe(true);
    expect(JSON.stringify(body)).toContain('https://example.com/watch');
  });

  it('discord channel delivers a single-embed payload', async () => {
    const stub = makeFetchStub(() => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', stub.fetch);
    const clock = makeFakeClock(T0 + HOUR);
    seedConditional({ id: 'w', conditions: [{ type: 'keyword', keyword: 'example' }], channel: 'discord' });
    const scheduler = makeScheduler(world, clock.clock);

    await scheduler.tick();
    world.state.structure = changedStructure();
    clock.advance(HOUR);
    await scheduler.tick();

    expect(stub.calls).toHaveLength(1);
    const body = JSON.parse(String(stub.calls[0]?.init?.body)) as Record<string, unknown>;
    const embeds = body['embeds'] as unknown[];
    expect(Array.isArray(embeds)).toBe(true);
    expect(embeds).toHaveLength(1);
  });

  it('priceBelow gates an extract run on a numeric jsonPath', async () => {
    const stub = makeFetchStub(() => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', stub.fetch);
    const clock = makeFakeClock(T0 + HOUR);
    seedConditional({ id: 'w', conditions: [{ type: 'priceBelow', jsonPath: '$.price', price: 50 }] });
    const scheduler = makeScheduler(world, clock.clock);

    world.state.structure = { ...BASE_STRUCTURE, price: 49.99 } as PageStructure;
    await scheduler.tick(); // baseline (unchanged) — no alert
    expect(stub.calls).toHaveLength(0);

    world.state.structure = { ...BASE_STRUCTURE, price: 49.99, title: 'touched' } as PageStructure;
    clock.advance(HOUR);
    await scheduler.tick(); // changed + 49.99 < 50 -> fires
    expect(stub.calls).toHaveLength(1);
  });
});
