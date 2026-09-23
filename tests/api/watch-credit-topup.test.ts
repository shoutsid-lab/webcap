import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApiFixture, errorEnvelope, makeApiFixture, type ApiFixture } from './fixture.js';

async function createWatch(fx: ApiFixture, mode: 'capture' | 'extract'): Promise<string> {
  const res = await fx.app.inject({
    method: 'POST',
    url: '/v1/watches',
    payload: { url: 'https://example.com/', every: '1h', mode },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

function topUp(fx: ApiFixture, watchId: string, payload: Record<string, unknown>, key?: string) {
  return fx.app.inject({
    method: 'POST',
    url: `/v1/watches/${watchId}/topup`,
    payload,
    ...(key !== undefined ? { headers: { authorization: `Bearer ${key}` } } : {}),
  });
}

describe('POST /v1/watches/:id/topup (credits rail)', () => {
  let fx: ApiFixture;
  let captureWatch: string;
  let extractWatch: string;
  beforeAll(async () => {
    fx = makeApiFixture();
    captureWatch = await createWatch(fx, 'capture');
    extractWatch = await createWatch(fx, 'extract');
  });
  afterAll(async () => {
    await closeApiFixture(fx);
  });

  it('is 401 without a key', async () => {
    const res = await topUp(fx, captureWatch, { runs: 100 });
    expect(res.statusCode).toBe(401);
  });

  it('is 422 when runs is not exactly 100 (before any charge)', async () => {
    fx.credits.grantCredits(fx.accountId, 200, 'watch-topup-seed');
    const before = fx.accounts.getBalance(fx.accountId);
    const res = await topUp(fx, captureWatch, { runs: 50 }, fx.apiKey);
    expect(res.statusCode).toBe(422);
    expect(fx.accounts.getBalance(fx.accountId)).toBe(before);
  });

  it('is 404 for an unknown watch (before any charge)', async () => {
    const before = fx.accounts.getBalance(fx.accountId);
    const res = await topUp(fx, '00000000-0000-0000-0000-000000000000', { runs: 100 }, fx.apiKey);
    expect(res.statusCode).toBe(404);
    expect(fx.accounts.getBalance(fx.accountId)).toBe(before);
  });

  it('is 402 with a top-up invoice when the balance cannot cover the pack', async () => {
    const poor = makeApiFixture();
    try {
      const watch = await createWatch(poor, 'capture');
      const res = await topUp(poor, watch, { runs: 100 }, poor.apiKey);
      expect(res.statusCode).toBe(402);
      const err = errorEnvelope(res);
      expect(err.code).toBe('insufficient_credits');
      const detail = err.detail as Record<string, unknown>;
      expect(typeof detail.invoiceId).toBe('string');
      expect(detail.requiredUsdc).toBe(0.1);
    } finally {
      await closeApiFixture(poor);
    }
  });

  it('funds a capture watch: 10 credits for 100 runs, watch unpauses', async () => {
    const res = await topUp(fx, captureWatch, { runs: 100 }, fx.apiKey);
    expect(res.statusCode).toBe(200);
    const json = res.json() as Record<string, unknown>;
    expect(json.watchId).toBe(captureWatch);
    expect(json.credits).toBe(100);
    expect(json.creditsCharged).toBe(10);
    expect(json.balance).toBe(190);
    const state = await fx.app.inject({ method: 'GET', url: `/v1/watches/${captureWatch}` });
    expect((state.json() as { paused: boolean }).paused).toBe(false);
  });

  it('funds an extract watch: 100 credits for 100 runs', async () => {
    const res = await topUp(fx, extractWatch, { runs: 100 }, fx.apiKey);
    expect(res.statusCode).toBe(200);
    const json = res.json() as Record<string, unknown>;
    expect(json.watchId).toBe(extractWatch);
    expect(json.credits).toBe(100);
    expect(json.creditsCharged).toBe(100);
    expect(json.balance).toBe(90);
  });
});

describe('spendN is atomic under concurrency', () => {
  it('10 concurrent 10-credit top-ups against 25 credits: exactly 2 win, balance ends at 5', async () => {
    const fx = makeApiFixture();
    try {
      const watch = await createWatch(fx, 'capture');
      fx.credits.grantCredits(fx.accountId, 25, 'watch-topup-seed');
      const responses = await Promise.all(
        Array.from({ length: 10 }, () => topUp(fx, watch, { runs: 100 }, fx.apiKey)),
      );
      const ok = responses.filter((res) => res.statusCode === 200);
      const rejected = responses.filter((res) => res.statusCode === 402);
      expect(ok).toHaveLength(2);
      expect(rejected).toHaveLength(8);
      expect(fx.accounts.getBalance(fx.accountId)).toBe(5);
    } finally {
      await closeApiFixture(fx);
    }
  });
});
