import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { openDb, type Db } from '../../src/db/index.js';
import { makeArtifactRepo, type ArtifactRepo } from '../../src/db/artifacts.js';
import { makeRevenueRepo, type RevenueRepo } from '../../src/db/revenue.js';
import { makeWatchRepo, type WatchRepo, type WatchRow } from '../../src/watch/store.js';
import { createWatchScheduler, type WatchClock, type WatchPipeline } from '../../src/watch/scheduler.js';
import { sha256Hex, stableStringify } from '../../src/watch/diff.js';
import type { WebcapConfig } from '../../src/config.js';
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

interface WebhookHit {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

async function startWebhookReceiver(): Promise<{ url: string; hits: WebhookHit[]; server: Server; close: () => Promise<void> }> {
  const hits: WebhookHit[] = [];
  const server = createServer((req, res) => {
    let data = '';
    req.on('data', (chunk) => {
      data += String(chunk);
    });
    req.on('end', () => {
      const body = JSON.parse(data === '' ? '{}' : data) as Record<string, unknown>;
      hits.push({ url: req.url ?? '', body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('webhook receiver has no port');
  return {
    url: `http://127.0.0.1:${address.port}/hook`,
    hits,
    server,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A port that refuses connections (listener opened + closed). */
async function deadPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = address !== null && typeof address !== 'string' ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (port === 0) throw new Error('dead port probe failed');
  return port;
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
  let receiver: { url: string; hits: WebhookHit[]; close: () => Promise<void> } | null = null;

  beforeEach(() => {
    world = makeWorld();
  });

  afterEach(async () => {
    if (receiver !== null) {
      await receiver.close();
      receiver = null;
    }
    world.close();
  });

  it('fires the webhook with the documented payload on a changed run; not on unchanged runs', async () => {
    receiver = await startWebhookReceiver();
    const clock = makeFakeClock(T0 + HOUR);
    seedWatch(world.repo, {
      id: 'w',
      webhookUrl: receiver.url,
      nextRunAt: new Date(T0).toISOString(),
      credits: 3,
    });
    const scheduler = makeScheduler(world, clock.clock);

    await scheduler.tick(); // baseline run — unchanged
    expect(receiver.hits).toHaveLength(0);

    world.state.captureBytes = Buffer.from('v2');
    clock.advance(HOUR);
    await scheduler.tick(); // changed run
    expect(receiver.hits).toHaveLength(1);
    const hit = receiver.hits[0];
    if (hit === undefined) throw new Error('no webhook hit recorded');
    expect(hit.url).toBe('/hook');
    expect(hit.body).toEqual({
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

    clock.advance(HOUR);
    await scheduler.tick(); // unchanged again — no alert
    expect(receiver.hits).toHaveLength(1);
  });

  it('an unreachable webhook does not fail the run (status stays ok, outcome logged)', async () => {
    const port = await deadPort();
    const clock = makeFakeClock(T0 + HOUR);
    seedWatch(world.repo, {
      id: 'w',
      webhookUrl: `http://127.0.0.1:${port}/hook`,
      nextRunAt: new Date(T0).toISOString(),
      credits: 2,
    });
    const scheduler = makeScheduler(world, clock.clock);

    await scheduler.tick(); // baseline (unchanged) — no webhook
    world.state.captureBytes = Buffer.from('v2');
    clock.advance(HOUR);
    await scheduler.tick(); // changed — webhook unreachable

    const runs = world.repo.recentRuns('w', 10);
    expect(runs[0]).toMatchObject({ status: 'ok', changed: 1 });
    expect(runs[0]?.webhook).toMatch(/^failed: /);
    const row = world.repo.get('w');
    if (row === null) throw new Error('watch vanished');
    expect(row.credits).toBe(0); // both runs consumed; the alert never failed the run
  });
});
