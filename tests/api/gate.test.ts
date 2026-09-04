import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApiFixture, errorEnvelope, makeApiFixture, type ApiFixture } from './fixture.js';

const CAPTURE_PAYLOAD = { url: 'https://example.com/' };

describe('S2: auth + 402 credit gate on /v1/capture', () => {
  let fx: ApiFixture;

  beforeAll(() => {
    fx = makeApiFixture();
  });

  afterAll(async () => {
    await closeApiFixture(fx);
  });

  it('rejects capture without an API key with 401', async () => {
    const res = await fx.app.inject({ method: 'POST', url: '/v1/capture', payload: CAPTURE_PAYLOAD });
    expect(res.statusCode).toBe(401);
    expect(errorEnvelope(res).code).toBe('unauthorized');
  });

  it('rejects capture with an unknown API key with 401', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/v1/capture',
      payload: CAPTURE_PAYLOAD,
      headers: { authorization: 'Bearer wc_live_0000000000000000000000000000beef' },
    });
    expect(res.statusCode).toBe(401);
    expect(errorEnvelope(res).code).toBe('unauthorized');
  });

  it('rejects capture with 402 and an auto-created top-up invoice when balance is 0', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/v1/capture',
      payload: CAPTURE_PAYLOAD,
      headers: { authorization: `Bearer ${fx.apiKey}` },
    });
    expect(res.statusCode).toBe(402);
    const envelope = errorEnvelope(res);
    expect(envelope.code).toBe('insufficient_credits');
    const detail = envelope.detail;
    expect(detail).toBeDefined();
    expect(typeof detail?.invoiceId).toBe('string');
    expect(detail?.invoiceId).not.toBe('');
    expect(detail?.requiredUsdc).toBe(0.01);
    expect(detail?.balance).toBe(0);
    expect(fx.accounts.getBalance(fx.accountId)).toBe(0);

    const topUp = fx.invoices.listByAccount(fx.accountId);
    expect(topUp).toHaveLength(1);
    expect(topUp[0]?.status).toBe('open');
  });
});
