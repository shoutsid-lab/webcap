import { describe, expect, it } from 'vitest';
import { Wallet } from 'ethers';
import { trialMessage } from '../../src/db/trials.js';
import { makeRevenueRepo } from '../../src/db/revenue.js';
import { closeApiFixture, makeApiFixture } from './fixture.js';

async function signedClaim(wallet: { address: string; signMessage(message: string): Promise<string> }): Promise<{ payer: string; signature: string }> {
  const payer = wallet.address.toLowerCase();
  return { payer, signature: await wallet.signMessage(trialMessage(payer)) };
}

describe('POST /v1/x402/trial — one free capture per wallet (EIP-191 proof)', () => {
  it('valid claim → 200 with PNG artifact, trial receipt, and paidNext pointer', async () => {
    const fx = makeApiFixture();
    try {
      const { payer, signature } = await signedClaim(Wallet.createRandom());
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/x402/trial',
        payload: { url: 'https://example.com', payer, signature },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        artifact: { format: string; url: string; data: string };
        trial: { payer: string; priceUsdcUnits: number };
        paidNext: { endpoint: string; priceUsdcUnits: number };
      };
      expect(body.artifact.format).toBe('png');
      expect(body.artifact.url).toContain('/v1/artifacts/');
      expect(body.artifact.data.length).toBeGreaterThan(0);
      expect(body.trial).toMatchObject({ payer, priceUsdcUnits: 0 });
      expect(body.paidNext.endpoint).toBe('POST /v1/x402/capture');
      expect(body.paidNext.priceUsdcUnits).toBe(fx.config.x402PriceUsdcUnits);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('second claim by the same wallet → 409 already_claimed (case-insensitive)', async () => {
    const fx = makeApiFixture();
    try {
      const wallet = Wallet.createRandom();
      const first = await signedClaim(wallet);
      const ok = await fx.app.inject({ method: 'POST', url: '/v1/x402/trial', payload: { url: 'https://example.com', ...first } });
      expect(ok.statusCode).toBe(200);
      const second = await fx.app.inject({
        method: 'POST',
        url: '/v1/x402/trial',
        payload: { url: 'https://example.com', payer: wallet.address, signature: first.signature },
      });
      expect(second.statusCode).toBe(409);
      expect((second.json() as { error: { code: string } }).error.code).toBe('already_claimed');
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
      const { payer, signature } = await signedClaim(Wallet.createRandom());
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
      const { payer, signature } = await signedClaim(Wallet.createRandom());
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
