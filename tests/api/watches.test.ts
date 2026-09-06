import { describe, expect, it } from 'vitest';
import { closeApiFixture, errorEnvelope, makeApiFixture, type ApiFixture } from './fixture.js';

function createValidBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { url: 'https://example.com/', every: '1h', mode: 'capture', ...over };
}

async function createWatch(fx: ApiFixture, body: Record<string, unknown> = createValidBody()): Promise<{ id: string }> {
  const res = await fx.app.inject({ method: 'POST', url: '/v1/watches', payload: body });
  if (res.statusCode !== 201) throw new Error(`expected 201, got ${res.statusCode}: ${res.payload}`);
  return res.json() as { id: string };
}

describe('POST /v1/watches (create a scheduled watch)', () => {
  it('creates a capture watch: 201 {id, state} with 0 credits, not paused, first run due now', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'POST', url: '/v1/watches', payload: createValidBody() });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; state: Record<string, unknown> };
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.state).toMatchObject({
        id: body.id,
        url: 'https://example.com/',
        every: '1h',
        mode: 'capture',
        credits: 0,
        paused: false,
        runs: [],
      });
      expect(typeof body.state.nextRunAt).toBe('string');
      expect(body.state.lastRunAt).toBeNull();
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('creates an extract watch with schema + webhook, echoed in the state', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/watches',
        payload: createValidBody({
          mode: 'extract',
          every: '24h',
          schema: 'Extract the title and all links',
          webhook: 'https://hooks.example.com/hook',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; state: Record<string, unknown> };
      expect(body.state).toMatchObject({
        mode: 'extract',
        every: '24h',
        schema: 'Extract the title and all links',
        webhook: 'https://hooks.example.com/hook',
      });
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('400 on a non-object body (or a missing one)', async () => {
    const fx = makeApiFixture();
    try {
      // JSON-encoded scalars/array so fastify parses the body and the handler
      // (not the JSON parser) produces the 400 bad_request envelope.
      const cases: Array<{ payload: string; headers?: Record<string, string> }> = [
        { payload: '"nope"', headers: { 'content-type': 'application/json' } },
        { payload: '42', headers: { 'content-type': 'application/json' } },
        { payload: '["url"]', headers: { 'content-type': 'application/json' } },
      ];
      for (const { payload, headers } of cases) {
        const res = await fx.app.inject({ method: 'POST', url: '/v1/watches', payload, headers });
        expect(res.statusCode).toBe(400);
        expect(errorEnvelope(res).code).toBe('bad_request');
      }
      const empty = await fx.app.inject({ method: 'POST', url: '/v1/watches' });
      expect(empty.statusCode).toBe(400);
      expect(errorEnvelope(empty).code).toBe('bad_request');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('400 on missing or invalid url (non-https, garbage, private host)', async () => {
    const fx = makeApiFixture();
    try {
      const badUrls: Array<Record<string, unknown>> = [
        {},
        { url: 42 },
        { url: 'not a url' },
        { url: 'http://example.com/' },
        { url: 'ftp://example.com/' },
        { url: 'https://127.0.0.1/secret' },
        { url: 'https://192.168.0.10/secret' },
      ];
      for (const body of badUrls) {
        const res = await fx.app.inject({ method: 'POST', url: '/v1/watches', payload: body });
        expect(res.statusCode).toBe(400);
        expect(errorEnvelope(res).code).toBe('bad_request');
      }
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('400 on bad every and bad mode', async () => {
    const fx = makeApiFixture();
    try {
      for (const every of ['5m', '1m', '2h', 'hourly', 60]) {
        const res = await fx.app.inject({ method: 'POST', url: '/v1/watches', payload: createValidBody({ every }) });
        expect(res.statusCode).toBe(400);
      }
      for (const mode of ['scrape', 'CAPTURE', 1]) {
        const res = await fx.app.inject({ method: 'POST', url: '/v1/watches', payload: createValidBody({ mode }) });
        expect(res.statusCode).toBe(400);
      }
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('400 on a non-https or invalid webhook, and on a non-string/empty schema', async () => {
    const fx = makeApiFixture();
    try {
      for (const webhook of ['http://hooks.example.com', 'not a url', 42, '']) {
        const res = await fx.app.inject({ method: 'POST', url: '/v1/watches', payload: createValidBody({ webhook }) });
        expect(res.statusCode).toBe(400);
        expect(errorEnvelope(res).message).toMatch(/webhook/);
      }
      for (const schema of ['', 42, ['title']]) {
        const res = await fx.app.inject({ method: 'POST', url: '/v1/watches', payload: createValidBody({ schema }) });
        expect(res.statusCode).toBe(400);
        expect(errorEnvelope(res).message).toMatch(/schema/);
      }
    } finally {
      await closeApiFixture(fx);
    }
  });
});

describe('GET /v1/watches/:id (watch state + recent runs)', () => {
  it('returns the full state with runs newest-first (capped at ~10)', async () => {
    const fx = makeApiFixture();
    try {
      const { id } = await createWatch(fx);
      const res = await fx.app.inject({ method: 'GET', url: `/v1/watches/${id}` });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body).toMatchObject({
        id,
        url: 'https://example.com/',
        every: '1h',
        mode: 'capture',
        credits: 0,
        paused: false,
        runs: [],
      });

      // Seed runs directly through the store (the scheduler is not started in tests).
      const { makeWatchRepo } = await import('../../src/watch/store.js');
      const repo = makeWatchRepo(fx.db);
      for (let i = 0; i < 12; i += 1) {
        repo.recordRun({
          watchId: id,
          status: 'ok',
          artifactUrl: null,
          extractJson: null,
          changed: i === 5,
          diffSummary: i === 5 ? 'artifact' : null,
          webhook: null,
          error: null,
          createdAt: new Date(1_700_000_000_000 + i * 1_000).toISOString(),
        });
      }
      const res2 = await fx.app.inject({ method: 'GET', url: `/v1/watches/${id}` });
      expect(res2.statusCode).toBe(200);
      const body2 = res2.json() as { runs: Array<{ id: number; changed: boolean }> };
      expect(body2.runs).toHaveLength(10);
      const ids = body2.runs.map((r) => r.id);
      expect(ids).toEqual([...ids].sort((a, b) => b - a)); // newest first
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('404 for an unknown id', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/v1/watches/does-not-exist' });
      expect(res.statusCode).toBe(404);
      expect(errorEnvelope(res).code).toBe('not_found');
    } finally {
      await closeApiFixture(fx);
    }
  });
});

describe('DELETE /v1/watches/:id', () => {
  it('deletes the watch and its runs: 204, then 404; runs removed', async () => {
    const fx = makeApiFixture();
    try {
      const { id } = await createWatch(fx);
      const { makeWatchRepo } = await import('../../src/watch/store.js');
      const repo = makeWatchRepo(fx.db);
      repo.recordRun({
        watchId: id,
        status: 'ok',
        artifactUrl: null,
        extractJson: null,
        changed: false,
        diffSummary: null,
        webhook: null,
        error: null,
        createdAt: new Date().toISOString(),
      });
      const runCount = fx.db.prepare<[string], { n: number }>('SELECT COUNT(*) AS n FROM watch_runs WHERE watch_id = ?');
      expect(runCount.get(id)?.n).toBe(1);

      const del = await fx.app.inject({ method: 'DELETE', url: `/v1/watches/${id}` });
      expect(del.statusCode).toBe(204);
      expect(runCount.get(id)?.n).toBe(0);

      const gone = await fx.app.inject({ method: 'GET', url: `/v1/watches/${id}` });
      expect(gone.statusCode).toBe(404);
      const delAgain = await fx.app.inject({ method: 'DELETE', url: `/v1/watches/${id}` });
      expect(delAgain.statusCode).toBe(404);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('404 for an unknown id', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'DELETE', url: '/v1/watches/does-not-exist' });
      expect(res.statusCode).toBe(404);
      expect(errorEnvelope(res).code).toBe('not_found');
    } finally {
      await closeApiFixture(fx);
    }
  });
});

describe('POST /v1/watches with conditions + channel (T4-S1/S2 ChatOps)', () => {
  it('persists conditions + channel and surfaces them in state and GET', async () => {
    const fx = makeApiFixture();
    try {
      const conditions = [
        { type: 'keyword', keyword: 'restock' },
        { type: 'priceBelow', jsonPath: '$.price', price: 100 },
      ];
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/watches',
        payload: createValidBody({ mode: 'extract', conditions, channel: 'slack' }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; state: Record<string, unknown> };
      expect(body.state).toMatchObject({ channel: 'slack', conditions });

      const got = await fx.app.inject({ method: 'GET', url: `/v1/watches/${body.id}` });
      expect(got.statusCode).toBe(200);
      expect(got.json()).toMatchObject({ channel: 'slack', conditions });
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('defaults to channel generic with no conditions key', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'POST', url: '/v1/watches', payload: createValidBody() });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { state: Record<string, unknown> };
      expect(body.state['channel']).toBe('generic');
      expect(body.state).not.toHaveProperty('conditions');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('422 unprocessable on an invalid jsonPath', async () => {
    const fx = makeApiFixture();
    try {
      for (const jsonPath of ['not-a-path', '$.', '$.a..b', "$['a']"]) {
        const res = await fx.app.inject({
          method: 'POST',
          url: '/v1/watches',
          payload: createValidBody({ conditions: [{ type: 'priceBelow', jsonPath, price: 10 }] }),
        });
        expect(res.statusCode).toBe(422);
        expect(errorEnvelope(res).code).toBe('unprocessable');
      }
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('422 on malformed conditions (non-array, unknown type, empty keyword)', async () => {
    const fx = makeApiFixture();
    try {
      const bad: unknown[] = [
        'keyword',
        [{ type: 'nope', keyword: 'x' }],
        [{ type: 'keyword', keyword: '' }],
        [{ type: 'priceBelow', jsonPath: '$.a', price: '10' }],
      ];
      for (const conditions of bad) {
        const res = await fx.app.inject({
          method: 'POST',
          url: '/v1/watches',
          payload: createValidBody({ conditions }),
        });
        expect(res.statusCode).toBe(422);
      }
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('400 on an invalid channel; non-https webhook still rejected alongside conditions', async () => {
    const fx = makeApiFixture();
    try {
      const badChannel = await fx.app.inject({
        method: 'POST',
        url: '/v1/watches',
        payload: createValidBody({ channel: 'sms', conditions: [{ type: 'keyword', keyword: 'x' }] }),
      });
      expect(badChannel.statusCode).toBe(400);

      const badWebhook = await fx.app.inject({
        method: 'POST',
        url: '/v1/watches',
        payload: createValidBody({
          webhook: 'http://hooks.example.com/hook',
          conditions: [{ type: 'keyword', keyword: 'x' }],
          channel: 'discord',
        }),
      });
      expect(badWebhook.statusCode).toBe(400);
      expect(errorEnvelope(badWebhook).message).toMatch(/webhook/);
    } finally {
      await closeApiFixture(fx);
    }
  });
});

describe('POST /v1/x402/watches/topup (local chain: x402 disabled)', () => {
  it('the route is present but returns 503 x402_disabled', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/x402/watches/topup',
        payload: { watchId: 'whatever', runs: 100 },
      });
      expect(res.statusCode).toBe(503);
      expect(errorEnvelope(res).code).toBe('x402_disabled');
    } finally {
      await closeApiFixture(fx);
    }
  });
});
