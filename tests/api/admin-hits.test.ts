import { describe, expect, it } from 'vitest';
import { makeAccountsRepo } from '../../src/db/accounts.js';
import { makeApiKeysRepo } from '../../src/db/api_keys.js';
import { recordHit } from '../../src/db/hits.js';
import { makeRevenueRepo } from '../../src/db/revenue.js';
import { generateApiKey, hashKey } from '../../src/util/keys.js';
import { MERCHANT_ADDRESS, closeApiFixture, errorEnvelope, makeApiFixture } from './fixture.js';

interface HitsSummaryRow {
  readonly endpoint: string;
  readonly hits: number;
  readonly paidCount: number;
  readonly conversion: number;
}

/** Seed the merchant account + key directly (live-chain abuse guard blocks merchant self-registration). */
function merchantKeyOf(fx: ReturnType<typeof makeApiFixture>): string {
  const merchantId = fx.accounts.findByAddress(MERCHANT_ADDRESS) ?? fx.accounts.create(MERCHANT_ADDRESS);
  const raw = generateApiKey();
  makeApiKeysRepo(fx.db).create(merchantId, hashKey(raw));
  return raw;
}

describe('metrics: merchant-only hits summary view (RED)', () => {
  it('merchant auth → 200 with per-endpoint {endpoint, hits, paidCount, conversion} join math', async () => {
    const fx = makeApiFixture();
    try {
      recordHit(fx.db, { endpoint: 'GET /v1/capture', status: 200 });
      recordHit(fx.db, { endpoint: 'GET /v1/capture', status: 200 });
      recordHit(fx.db, { endpoint: 'POST /v1/capture', status: 200 });
      const revenue = makeRevenueRepo(fx.db);
      revenue.record({ endpoint: 'GET /v1/capture', payer: '0xabc', revenueUsdcUnits: 1_000, costUsdcUnits: 200 });

      const res = await fx.app.inject({
        method: 'GET',
        url: '/v1/admin/hits/summary',
        headers: { authorization: `Bearer ${merchantKeyOf(fx)}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { summary: HitsSummaryRow[] };
      const byEndpoint = new Map(body.summary.map((row) => [row.endpoint, row]));
      expect(byEndpoint.get('GET /v1/capture')).toMatchObject({ endpoint: 'GET /v1/capture', hits: 2, paidCount: 1, conversion: 0.5 });
      expect(byEndpoint.get('POST /v1/capture')).toMatchObject({ endpoint: 'POST /v1/capture', hits: 1, paidCount: 0, conversion: 0 });
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('non-merchant → 403 forbidden; missing key → 401', async () => {
    const fx = makeApiFixture();
    try {
      const forbidden = await fx.app.inject({
        method: 'GET',
        url: '/v1/admin/hits/summary',
        headers: { authorization: `Bearer ${fx.apiKey}` },
      });
      expect(forbidden.statusCode).toBe(403);
      expect(errorEnvelope(forbidden).code).toBe('forbidden');

      const missing = await fx.app.inject({ method: 'GET', url: '/v1/admin/hits/summary' });
      expect(missing.statusCode).toBe(401);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('empty window → 200 with zeros (never null-crash)', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({
        method: 'GET',
        url: '/v1/admin/hits/summary',
        headers: { authorization: `Bearer ${merchantKeyOf(fx)}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { summary: HitsSummaryRow[] };
      expect(Array.isArray(body.summary)).toBe(true);
      expect(body.summary).toEqual([]);
      for (const row of body.summary) {
        expect(row.hits).toBe(0);
        expect(row.paidCount).toBe(0);
        expect(row.conversion).toBe(0);
      }
    } finally {
      await closeApiFixture(fx);
    }
  });
});
