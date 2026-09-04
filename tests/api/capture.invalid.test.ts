import { describe, expect, it } from 'vitest';
import { closeApiFixture, errorEnvelope, makeApiFixture } from './fixture.js';

async function expectRejectedCapture(url: string): Promise<void> {
  const fx = makeApiFixture();
  try {
    fx.credits.grantCredits(fx.accountId, 1, 'test_seed');
    const res = await fx.app.inject({
      method: 'POST',
      url: '/v1/capture',
      payload: { url },
      headers: { authorization: `Bearer ${fx.apiKey}` },
    });
    expect(res.statusCode).toBe(422);
    expect(errorEnvelope(res).code).toBe('unprocessable');
    expect(fx.accounts.getBalance(fx.accountId)).toBe(1);
  } finally {
    await closeApiFixture(fx);
  }
}

describe('S3: capture input validation rejects before charging', () => {
  it('returns 422 for a malformed url and leaves the balance untouched', async () => {
    await expectRejectedCapture('not-a-url');
  });

  it('returns 422 for a private-IP url and leaves the balance untouched', async () => {
    await expectRejectedCapture('http://10.0.0.1/x');
  });

  it('returns 422 for a loopback url and leaves the balance untouched', async () => {
    await expectRejectedCapture('http://127.0.0.1:9999/x');
  });
});
