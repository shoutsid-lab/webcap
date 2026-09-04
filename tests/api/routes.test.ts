import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_ADDRESS,
  closeApiFixture,
  errorEnvelope,
  makeApiFixture,
  MERCHANT_ADDRESS,
  USDC_ADDRESS,
  type ApiFixture,
} from './fixture.js';
import { CaptureError } from '../../src/capture/errors.js';

interface JsonBody {
  [key: string]: unknown;
}

function body(res: { json(): unknown }): JsonBody {
  return res.json() as JsonBody;
}

describe('/v1/health', () => {
  it('returns 200 with chain and credit pricing (no auth)', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/v1/health' });
      expect(res.statusCode).toBe(200);
      const json = body(res);
      expect(json.ok).toBe(true);
      expect(json.chainId).toBe(31337);
      expect(json.creditsPerUsdc).toBe(100);
      expect(json.pricePerCredit).toBe(0.01);
    } finally {
      await closeApiFixture(fx);
    }
  });
});

describe('/v1/invoice', () => {
  it('creates a 201 invoice with requiredUsdc = credits / 100', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/invoice',
        payload: {},
        headers: { authorization: `Bearer ${fx.apiKey}` },
      });
      expect(res.statusCode).toBe(201);
      const json = body(res);
      expect(typeof json.invoiceId).toBe('string');
      expect(json.invoiceId).not.toBe('');
      expect(json.merchant).toBe(MERCHANT_ADDRESS);
      expect(json.token).toBe(USDC_ADDRESS);
      expect(json.chainId).toBe(31337);
      expect(json.requiredUsdc).toBe(1);
      expect(json.credits).toBe(100);
      const expiresAt = new Date(json.expiresAt as string).getTime();
      expect(expiresAt).toBeGreaterThan(Date.now());
      expect(expiresAt).toBeLessThan(Date.now() + 3_600_000 + 60_000);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('honours an explicit credit amount', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/invoice',
        payload: { credits: 5 },
        headers: { authorization: `Bearer ${fx.apiKey}` },
      });
      expect(res.statusCode).toBe(201);
      const json = body(res);
      expect(json.credits).toBe(5);
      expect(json.requiredUsdc).toBe(0.05);
    } finally {
      await closeApiFixture(fx);
    }
  });
});

describe('/v1/account', () => {
  it('returns address, balance and the account invoices', async () => {
    const fx = makeApiFixture();
    try {
      fx.credits.grantCredits(fx.accountId, 7, 'test_seed');
      await fx.app.inject({ method: 'POST', url: '/v1/invoice', payload: { credits: 5 }, headers: { authorization: `Bearer ${fx.apiKey}` } });

      const res = await fx.app.inject({
        method: 'GET',
        url: '/v1/account',
        headers: { authorization: `Bearer ${fx.apiKey}` },
      });
      expect(res.statusCode).toBe(200);
      const json = body(res);
      expect(json.address).toBe(CUSTOMER_ADDRESS);
      expect(json.balance).toBe(7);
      const invoices = json.invoices as JsonBody[];
      expect(invoices).toHaveLength(1);
      expect(invoices[0]?.id).toBeTypeOf('string');
      expect(invoices[0]?.status).toBe('open');
      expect(invoices[0]?.credits).toBe(5);
      expect(invoices[0]?.requiredUsdc).toBe(0.05);
      expect(typeof invoices[0]?.createdAt).toBe('string');
    } finally {
      await closeApiFixture(fx);
    }
  });
});

describe('/v1/capture happy path (stubbed capture)', () => {
  it('charges 1 credit and returns the base64 artifact', async () => {
    const fx = makeApiFixture();
    try {
      fx.credits.grantCredits(fx.accountId, 2, 'test_seed');
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/capture',
        payload: { url: 'https://example.com/', format: 'jpeg' },
        headers: { authorization: `Bearer ${fx.apiKey}` },
      });
      expect(res.statusCode).toBe(200);
      const json = body(res);
      const artifact = json.artifact as JsonBody;
      expect(artifact.format).toBe('jpeg');
      expect(artifact.bytes).toBe(8);
      expect(Buffer.from(artifact.data as string, 'base64').subarray(0, 4).toString('hex')).toBe('89504e47');
      expect(json.creditsCharged).toBe(1);
      expect(json.balance).toBe(1);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('refunds the debit and returns 502 when the capture fails at runtime', async () => {
    const fx = makeApiFixture({
      capture: async (): Promise<never> => {
        throw new CaptureError('page load failed');
      },
    });
    try {
      fx.credits.grantCredits(fx.accountId, 1, 'test_seed');
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/capture',
        payload: { url: 'https://example.com/' },
        headers: { authorization: `Bearer ${fx.apiKey}` },
      });
      expect(res.statusCode).toBe(502);
      expect(errorEnvelope(res).code).toBe('capture_failed');
      expect(fx.accounts.getBalance(fx.accountId)).toBe(1);
    } finally {
      await closeApiFixture(fx);
    }
  });
});

describe('/v1/og', () => {
  it('returns og metadata without auth', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/v1/og?url=https%3A%2F%2Fexample.com%2F' });
      expect(res.statusCode).toBe(200);
      const json = body(res);
      expect(json.url).toBe('https://example.com/');
      expect(json.title).toBe('Stub Title');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('returns 422 for a bad url', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/v1/og?url=nope' });
      expect(res.statusCode).toBe(422);
      expect(errorEnvelope(res).code).toBe('unprocessable');
    } finally {
      await closeApiFixture(fx);
    }
  });
});
