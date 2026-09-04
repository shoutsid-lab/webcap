import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApiFixture, makeApiFixture, type ApiFixture } from './fixture.js';

const CAPTURE_PAYLOAD = { url: 'https://example.com/' };

function fireCaptures(fx: ApiFixture, count: number) {
  return Promise.all(
    Array.from({ length: count }, () =>
      fx.app.inject({
        method: 'POST',
        url: '/v1/capture',
        payload: CAPTURE_PAYLOAD,
        headers: { authorization: `Bearer ${fx.apiKey}` },
      }),
    ),
  );
}

function debitsFor(fx: ApiFixture): number {
  return fx.credits.getLedger(fx.accountId).filter((row) => row.delta === -1).length;
}

describe('S5: concurrent /v1/capture against 100 credits never loses a debit', () => {
  let fx: ApiFixture;

  beforeAll(() => {
    fx = makeApiFixture();
    fx.credits.grantCredits(fx.accountId, 100, 's5-seed');
  });

  afterAll(async () => {
    await closeApiFixture(fx);
  });

  it('10 concurrent captures all return 200, balance is exactly 90, and the ledger has exactly 10 debits', async () => {
    const responses = await fireCaptures(fx, 10);
    for (const res of responses) expect(res.statusCode).toBe(200);
    expect(fx.accounts.getBalance(fx.accountId)).toBe(90);
    expect(debitsFor(fx)).toBe(10);
  });
});

describe('S5: concurrent /v1/capture can never oversell a balance below zero', () => {
  let fx: ApiFixture;

  beforeAll(() => {
    fx = makeApiFixture();
    fx.credits.grantCredits(fx.accountId, 3, 's5-seed');
  });

  afterAll(async () => {
    await closeApiFixture(fx);
  });

  it('10 concurrent captures against 3 credits: exactly 3 win (200), 7 get 402, balance is exactly 0', async () => {
    const responses = await fireCaptures(fx, 10);
    const ok = responses.filter((res) => res.statusCode === 200);
    const rejected = responses.filter((res) => res.statusCode === 402);
    expect(ok).toHaveLength(3);
    expect(rejected).toHaveLength(7);
    expect(fx.accounts.getBalance(fx.accountId)).toBe(0);
    expect(debitsFor(fx)).toBe(3);
  });
});
