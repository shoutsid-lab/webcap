import { describe, expect, it, vi, afterEach } from 'vitest';
import { Wallet } from 'ethers';
import { trialMessage, trialMessageFor, type TrialEndpoint } from '../../src/db/trials.js';
import { makeRevenueRepo } from '../../src/db/revenue.js';
import { closeApiFixture, makeApiFixture } from './fixture.js';

type Signer = { address: string; signMessage(message: string): Promise<string> };

async function signedLegacy(wallet: Signer): Promise<{ payer: string; signature: string }> {
  const payer = wallet.address.toLowerCase();
  return { payer, signature: await wallet.signMessage(trialMessage(payer)) };
}

async function signedFor(wallet: Signer, endpoint: TrialEndpoint): Promise<{ payer: string; signature: string }> {
  const payer = wallet.address.toLowerCase();
  return { payer, signature: await wallet.signMessage(trialMessageFor(endpoint, payer)) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockSitemapFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/sitemap.xml')) {
        return new Response(
          '<?xml version="1.0"?><urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b</loc></url></urlset>',
          { status: 200, headers: { 'content-type': 'application/xml' } },
        );
      }
      return new Response('not found', { status: 404 });
    }),
  );
}

describe('POST /v1/x402/trial — one free capture per wallet (EIP-191 proof)', () => {
  it('legacy capture message → 200 with PNG artifact, trial receipt, paidNext + remaining', async () => {
    const fx = makeApiFixture();
    try {
      const { payer, signature } = await signedLegacy(Wallet.createRandom());
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/x402/trial',
        payload: { url: 'https://example.com', payer, signature },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        artifact: { format: string; url: string; data: string };
        trial: { payer: string; endpoint: string; priceUsdcUnits: number };
        paidNext: { endpoint: string; priceUsdcUnits: number };
        remaining: string[];
      };
      expect(body.artifact.format).toBe('png');
      expect(body.artifact.url).toContain('/v1/artifacts/');
      expect(body.artifact.data.length).toBeGreaterThan(0);
      expect(body.trial).toMatchObject({ payer, endpoint: 'capture', priceUsdcUnits: 0 });
      expect(body.paidNext.endpoint).toBe('POST /v1/x402/capture');
      expect(body.paidNext.priceUsdcUnits).toBe(fx.config.x402PriceUsdcUnits);
      expect(body.remaining).toEqual(['extract', 'audit', 'map-lite', 'analyze']);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('endpoint-bound capture message → 200 (new recipe works for capture)', async () => {
    const fx = makeApiFixture();
    try {
      const { payer, signature } = await signedFor(Wallet.createRandom(), 'capture');
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/x402/trial',
        payload: { url: 'https://example.com', payer, signature },
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('second claim by the same wallet → 409 already_claimed with paidNext + remaining (case-insensitive)', async () => {
    const fx = makeApiFixture();
    try {
      const wallet = Wallet.createRandom();
      const first = await signedLegacy(wallet);
      const ok = await fx.app.inject({ method: 'POST', url: '/v1/x402/trial', payload: { url: 'https://example.com', ...first } });
      expect(ok.statusCode).toBe(200);
      const second = await fx.app.inject({
        method: 'POST',
        url: '/v1/x402/trial',
        payload: { url: 'https://example.com', payer: wallet.address, signature: first.signature },
      });
      expect(second.statusCode).toBe(409);
      const body = second.json() as { error: { code: string; detail: { remaining: string[] } } };
      expect(body.error.code).toBe('already_claimed');
      expect(body.error.detail.remaining).toEqual(['extract', 'audit', 'map-lite', 'analyze']);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('signature for another wallet → 401; malformed signature → 401', async () => {
    const fx = makeApiFixture();
    try {
      const alice = Wallet.createRandom();
      const bob = Wallet.createRandom();
      const bobLower = bob.address.toLowerCase();
      const wrongOwner = await alice.signMessage(trialMessage(bobLower));
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/x402/trial',
        payload: { url: 'https://example.com', payer: bobLower, signature: wrongOwner },
      });
      expect(res.statusCode).toBe(401);

      const malformed = await fx.app.inject({
        method: 'POST',
        url: '/v1/x402/trial',
        payload: { url: 'https://example.com', payer: bobLower, signature: '0xdead' },
      });
      expect(malformed.statusCode).toBe(401);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('missing fields → 422; non-address payer → 422', async () => {
    const fx = makeApiFixture();
    try {
      for (const payload of [{}, { url: 'https://example.com' }, { url: 'https://example.com', payer: '0xabc' }]) {
        const res = await fx.app.inject({ method: 'POST', url: '/v1/x402/trial', payload });
        expect(res.statusCode).toBe(422);
      }
      const badAddr = await fx.app.inject({
        method: 'POST',
        url: '/v1/x402/trial',
        payload: { url: 'https://example.com', payer: 'not-an-address', signature: '0x00' },
      });
      expect(badAddr.statusCode).toBe(422);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('trial never touches the revenue ledger (free means free)', async () => {
    const fx = makeApiFixture();
    try {
      const { payer, signature } = await signedLegacy(Wallet.createRandom());
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/x402/trial',
        payload: { url: 'https://example.com', payer, signature },
      });
      expect(res.statusCode).toBe(200);
      expect(makeRevenueRepo(fx.db).recent(10)).toEqual([]);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('capture failure releases the reservation so a retry can claim', async () => {
    const fx = makeApiFixture({
      capture: async () => {
        throw new Error('browser pool exhausted');
      },
    });
    try {
      const { payer, signature } = await signedLegacy(Wallet.createRandom());
      const failed = await fx.app.inject({
        method: 'POST',
        url: '/v1/x402/trial',
        payload: { url: 'https://example.com', payer, signature },
      });
      expect(failed.statusCode).toBe(500);
      const rows = fx.db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM trial_claims').get();
      expect(rows?.n).toBe(0);
    } finally {
      await closeApiFixture(fx);
    }
  });
});

describe('trial extract/audit/map-lite/analyze — one free result per wallet per endpoint', () => {
  it('extract trial → 200 with results + receipt; repeat → 409; capture claim stays independent', async () => {
    const fx = makeApiFixture();
    try {
      const wallet = Wallet.createRandom();
      const claim = await signedFor(wallet, 'extract');
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/x402/trial/extract',
        payload: { url: 'https://example.com', ...claim },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        results: Array<{ url: string; status: string; data: { title: string } }>;
        trial: { payer: string; endpoint: string; priceUsdcUnits: number };
        paidNext: { endpoint: string; priceUsdcUnits: number };
        remaining: string[];
      };
      expect(body.results[0]?.status).toBe('ok');
      expect(body.results[0]?.data.title).toBe('Stub Title');
      expect(body.trial).toMatchObject({ endpoint: 'extract', priceUsdcUnits: 0 });
      expect(body.paidNext.endpoint).toBe('POST /v1/x402/extract');
      expect(body.paidNext.priceUsdcUnits).toBe(fx.config.x402ExtractPriceUsdcUnits);
      expect(body.remaining).not.toContain('extract');
      expect(body.remaining).toContain('capture');
      expect(makeRevenueRepo(fx.db).recent(10)).toEqual([]);

      const again = await fx.app.inject({
        method: 'POST',
        url: '/v1/x402/trial/extract',
        payload: { url: 'https://example.com', ...claim },
      });
      expect(again.statusCode).toBe(409);

      // The extract claim does not burn the capture trial.
      const captureClaim = await signedLegacy(wallet);
      const capture = await fx.app.inject({
        method: 'POST',
        url: '/v1/x402/trial',
        payload: { url: 'https://example.com', ...captureClaim },
      });
      expect(capture.statusCode).toBe(200);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('a capture signature cannot be replayed for extract (endpoint-bound messages) → 401', async () => {
    const fx = makeApiFixture();
    try {
      const wallet = Wallet.createRandom();
      const captureClaim = await signedLegacy(wallet);
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/x402/trial/extract',
        payload: { url: 'https://example.com', ...captureClaim },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('extract trial rejects paid-only fields (urls batch, schema, model) → 422', async () => {
    const fx = makeApiFixture();
    try {
      const wallet = Wallet.createRandom();
      const claim = await signedFor(wallet, 'extract');
      for (const payload of [
        { urls: ['https://example.com'], ...claim },
        { url: 'https://example.com', schema: 'company name', ...claim },
        { url: 'https://example.com', model: 'x', ...claim },
      ]) {
        const res = await fx.app.inject({ method: 'POST', url: '/v1/x402/trial/extract', payload });
        expect(res.statusCode).toBe(422);
      }
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('audit trial → 200 with audit payload + receipt pointing at paid audit', async () => {
    const fx = makeApiFixture();
    try {
      const { payer, signature } = await signedFor(Wallet.createRandom(), 'audit');
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/x402/trial/audit',
        payload: { url: 'https://example.com', payer, signature },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        audit: { url: string };
        trial: { endpoint: string; priceUsdcUnits: number };
        paidNext: { endpoint: string; priceUsdcUnits: number };
      };
      expect(body.audit.url).toBe('https://example.com/');
      expect(body.trial).toMatchObject({ endpoint: 'audit', priceUsdcUnits: 0 });
      expect(body.paidNext.endpoint).toBe('POST /v1/x402/audit');
      expect(body.paidNext.priceUsdcUnits).toBe(fx.config.x402AuditPriceUsdcUnits);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('map-lite trial → 200 with URL list capped at 10', async () => {
    mockSitemapFetch();
    const fx = makeApiFixture();
    try {
      const { payer, signature } = await signedFor(Wallet.createRandom(), 'map-lite');
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/x402/trial/map-lite',
        payload: { url: 'https://example.com', maxUrls: 50, payer, signature },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        urls: string[];
        trial: { endpoint: string; maxUrlsCap: number };
        paidNext: { endpoint: string };
      };
      expect(body.urls).toEqual(['https://example.com/a', 'https://example.com/b']);
      expect(body.trial).toMatchObject({ endpoint: 'map-lite', maxUrlsCap: 10 });
      expect(body.paidNext.endpoint).toBe('POST /v1/x402/map-lite');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('analyze trial → 200 deterministic result even though no model is configured', async () => {
    const fx = makeApiFixture();
    try {
      const { payer, signature } = await signedFor(Wallet.createRandom(), 'analyze');
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/x402/trial/analyze',
        payload: { url: 'https://example.com', task: 'classification', payer, signature },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        task: string;
        result: unknown;
        trial: { endpoint: string; model: string };
        paidNext: { endpoint: string };
      };
      expect(body.task).toBe('classification');
      expect(body.result).toBeDefined();
      expect(body.trial).toMatchObject({ endpoint: 'analyze', model: 'deterministic (trial)' });
      expect(body.paidNext.endpoint).toBe('POST /v1/x402/analyze');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('analyze trial rejects missing/unsupported tasks → 422', async () => {
    const fx = makeApiFixture();
    try {
      const wallet = Wallet.createRandom();
      const claim = await signedFor(wallet, 'analyze');
      for (const payload of [
        { url: 'https://example.com', ...claim },
        { url: 'https://example.com', task: 'teleport', ...claim },
      ]) {
        const res = await fx.app.inject({ method: 'POST', url: '/v1/x402/trial/analyze', payload });
        expect(res.statusCode).toBe(422);
      }
    } finally {
      await closeApiFixture(fx);
    }
  });
});

describe('GET /v1/x402/trial/status — machine-readable trial menu', () => {
  it('fresh wallet → five available; after a claim → claimed + recipe + example', async () => {
    const fx = makeApiFixture();
    try {
      const wallet = Wallet.createRandom();
      const payer = wallet.address.toLowerCase();
      const fresh = await fx.app.inject({ method: 'GET', url: `/v1/x402/trial/status?payer=${payer}` });
      expect(fresh.statusCode).toBe(200);
      const freshBody = fresh.json() as {
        payer: string;
        claimed: string[];
        available: Array<{ endpoint: string; trial: string; paid: string; priceUsdc: number }>;
        howToClaim: { messageTemplate: string; signature: string; example: string };
      };
      expect(freshBody.payer).toBe(payer);
      expect(freshBody.claimed).toEqual([]);
      expect(freshBody.available.map((a) => a.endpoint)).toEqual(['capture', 'extract', 'audit', 'map-lite', 'analyze']);
      expect(freshBody.available[0]?.trial).toBe('POST /v1/x402/trial');
      expect(freshBody.available[1]?.trial).toBe('POST /v1/x402/trial/extract');
      expect(freshBody.howToClaim.messageTemplate).toContain('{endpoint}');
      expect(freshBody.howToClaim.example).toBe(trialMessageFor('capture', payer));

      const claim = await signedLegacy(wallet);
      const claimed = await fx.app.inject({ method: 'POST', url: '/v1/x402/trial', payload: { url: 'https://example.com', ...claim } });
      expect(claimed.statusCode).toBe(200);

      const after = await fx.app.inject({ method: 'GET', url: `/v1/x402/trial/status?payer=${payer}` });
      const afterBody = after.json() as { claimed: string[]; available: Array<{ endpoint: string }> };
      expect(afterBody.claimed).toEqual(['capture']);
      expect(afterBody.available.map((a) => a.endpoint)).toEqual(['extract', 'audit', 'map-lite', 'analyze']);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('missing/invalid payer → 422', async () => {
    const fx = makeApiFixture();
    try {
      for (const url of ['/v1/x402/trial/status', '/v1/x402/trial/status?payer=nope']) {
        const res = await fx.app.inject({ method: 'GET', url });
        expect(res.statusCode).toBe(422);
      }
    } finally {
      await closeApiFixture(fx);
    }
  });
});

describe('GET /v1/x402/trial/quick — no-wallet thumbnail faucet', () => {
  it('serves a JPEG thumbnail with budget state + trial pointer; 4th call same day → 429', async () => {
    const fx = makeApiFixture();
    try {
      for (let i = 1; i <= 3; i += 1) {
        const thumb = await fx.app.inject({ method: 'GET', url: '/v1/x402/trial/quick?url=https://example.com' });
        expect(thumb.statusCode).toBe(200);
        const body = thumb.json() as {
          artifact: { format: string; url: string };
          faucet: { plan: string; usedToday: number; dailyLimit: number };
          trial: { endpoint: string };
        };
        expect(body.artifact.format).toBe('jpeg');
        expect(body.artifact.url).toContain('/v1/artifacts/');
        expect(body.faucet).toMatchObject({ plan: 'no-wallet thumbnail', usedToday: i, dailyLimit: 3 });
        expect(body.trial.endpoint).toBe('POST /v1/x402/trial');
      }
      const spent = await fx.app.inject({ method: 'GET', url: '/v1/x402/trial/quick?url=https://example.com' });
      expect(spent.statusCode).toBe(429);
      expect((spent.json() as { error: { code: string } }).error.code).toBe('faucet_exhausted');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('missing url → 422', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/v1/x402/trial/quick' });
      expect(res.statusCode).toBe(422);
    } finally {
      await closeApiFixture(fx);
    }
  });
});
