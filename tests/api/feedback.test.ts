import { describe, expect, it } from 'vitest';
import {
  closeApiFixture,
  makeApiFixture,
  MERCHANT_ADDRESS,
  type ApiFixture,
  type ErrorEnvelope,
} from './fixture.js';
import { makeApiKeysRepo } from '../../src/db/api_keys.js';
import { hashKey } from '../../src/util/keys.js';

/** Seed the merchant account + key directly (live-chain abuse guard blocks merchant self-registration). */
function merchantKeyOf(fx: ApiFixture): string {
  const merchantId = fx.accounts.findByAddress(MERCHANT_ADDRESS) ?? fx.accounts.create(MERCHANT_ADDRESS);
  const raw = 'merchant-test-key';
  makeApiKeysRepo(fx.db).create(merchantId, hashKey(raw));
  return raw;
}

describe('POST /v1/feedback (machine + human form)', () => {
  it('machine JSON: 200 {ok, id, category} and persists a hashed-payer row', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/feedback',
        payload: { message: 'The 402 challenge was confusing.', category: 'docs', payer: '0xe3Badbd4f38214b9Eae528a1a5398f6678f63fB3' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { ok?: boolean; id?: number; category?: string };
      expect(body.ok).toBe(true);
      expect(typeof body.id).toBe('number');
      expect(body.category).toBe('docs');

      // Payer is never stored raw.
      const row = fx.db
        .prepare<[number], { payer_hash: string; message: string; endpoint: string | null }>(
          'SELECT payer_hash, message, endpoint FROM feedback WHERE id = ?',
        )
        .get(body.id as number);
      expect(row?.message).toBe('The 402 challenge was confusing.');
      expect(row?.payer_hash).not.toContain('0xe3Badbd4');
      expect(row?.payer_hash.length).toBeGreaterThan(8);
      expect(row?.endpoint).toBeNull();
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('accepts optional category + endpoint and defaults category to other when omitted', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/feedback',
        payload: { message: 'Please add a bing engine.', endpoint: 'GET /v1/extract/preview' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { category?: string };
      expect(body.category).toBe('other');
      const row = fx.db
        .prepare<[], { endpoint: string | null }>('SELECT endpoint FROM feedback ORDER BY id DESC LIMIT 1')
        .get();
      expect(row?.endpoint).toBe('GET /v1/extract/preview');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('human urlencoded form with Accept html: renders the confirmation page, not raw JSON', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/feedback',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
        payload: 'category=bug&message=I%20hit%20a%20502%20on%20skunkwork.xyz',
      });
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['content-type'])).toContain('text/html');
      expect(res.payload).toContain('Thanks');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('human urlencoded machine (no Accept html): returns JSON', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/feedback',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'message=This%20is%20a%20test%20message',
      });
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['content-type'])).toContain('application/json');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('rejects a too-short / missing message with 422', async () => {
    const fx = makeApiFixture();
    try {
      const missing = await fx.app.inject({ method: 'POST', url: '/v1/feedback', payload: {} });
      expect(missing.statusCode).toBe(422);
      expect((missing.json() as { error: ErrorEnvelope }).error.code).toBe('unprocessable');

      const short = await fx.app.inject({ method: 'POST', url: '/v1/feedback', payload: { message: 'nope' } });
      expect(short.statusCode).toBe(422);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('rate-limits per client (60/hr) with a 429 + retry-after', async () => {
    const fx = makeApiFixture();
    try {
      const limiter = (fx.app as { feedbackLimiter?: unknown }).feedbackLimiter;
      // Climb past the limit: the limiter is process-local, so post 60 times.
      let last = 200;
      for (let i = 0; i < 61; i++) {
        const res = await fx.app.inject({ method: 'POST', url: '/v1/feedback', payload: { message: 'burst message for the limit test' } });
        last = res.statusCode;
        if (res.statusCode !== 200) break;
      }
      // The injected requests share a loopback ip key, so one shared bucket fills.
      expect(last).toBe(429);
      void limiter;
    } finally {
      await closeApiFixture(fx);
    }
  });
});

describe('GET /v1/feedback/list (merchant-only)', () => {
  it('merchant key → 200 with the stored rows, newest first', async () => {
    const fx = makeApiFixture();
    try {
      await fx.app.inject({ method: 'POST', url: '/v1/feedback', payload: { message: 'First note for the list', category: 'bug' } });
      await fx.app.inject({ method: 'POST', url: '/v1/feedback', payload: { message: 'Second note for the list', category: 'suggestion' } });
      const res = await fx.app.inject({
        method: 'GET',
        url: '/v1/feedback/list',
        headers: { authorization: `Bearer ${merchantKeyOf(fx)}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { feedback: Array<{ message: string; category: string; payer_hash: string }> };
      expect(body.feedback.length).toBe(2);
      expect(body.feedback[0]?.message).toBe('Second note for the list');
      expect(body.feedback[1]?.message).toBe('First note for the list');
      expect(body.feedback[0]?.payer_hash).toBe('anonymous');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('non-merchant or missing key → 403 / 401', async () => {
    const fx = makeApiFixture();
    try {
      const nonMerchant = await fx.app.inject({
        method: 'GET',
        url: '/v1/feedback/list',
        headers: { authorization: `Bearer ${fx.apiKey}` },
      });
      expect(nonMerchant.statusCode).toBe(403);
      const missing = await fx.app.inject({ method: 'GET', url: '/v1/feedback/list' });
      expect(missing.statusCode).toBe(401);
    } finally {
      await closeApiFixture(fx);
    }
  });
});

describe('GET /feedback (human page)', () => {
  it('200 text/html with the form posting to /v1/feedback', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/feedback' });
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['content-type'])).toContain('text/html');
      expect(res.payload).toContain('method="post"');
      expect(res.payload).toContain('action="/v1/feedback"');
      expect(res.payload).toContain('name="message"');
    } finally {
      await closeApiFixture(fx);
    }
  });
});
