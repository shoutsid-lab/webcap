/**
 * The merchant-only hits summary view: GET /v1/admin/hits/summary joins
 * endpoint_hits counts (by endpoint) with revenue_ledger paid counts and
 * reports conversion = paid/hits (0 when hits is 0, never null). Merchant
 * guard reuses the GET /v1/ledger pattern (Bearer auth + merchant-address
 * comparison) — no new auth system.
 *
 * Explicitly out of scope: emails, trials, triggers.
 */
/* deferred to run #4: per-endpoint rollup triggers (counts/revenue join) live in schema.sql. */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.js';
import { HttpError } from '../util/errors.js';
import { authenticate } from './auth.js';
import type { AppDeps } from './server.js';

export interface HitsSummaryRow {
  readonly endpoint: string;
  readonly hits: number;
  readonly paidCount: number;
  readonly conversion: number;
}

interface HitsPaidJoin {
  readonly endpoint: string;
  readonly hits: number;
  readonly paidCount: number;
}

/** Per-endpoint hits joined with paid counts; endpoints with no paid rows keep paidCount 0. */
export function hitsSummary(db: Db): HitsSummaryRow[] {
  const rows = db
    .prepare<[], HitsPaidJoin>(
      'SELECT h.endpoint AS endpoint, h.hits AS hits, COALESCE(p.paid, 0) AS paidCount ' +
        'FROM (SELECT endpoint, COUNT(*) AS hits FROM endpoint_hits GROUP BY endpoint) h ' +
        'LEFT JOIN (SELECT endpoint, COUNT(*) AS paid FROM revenue_ledger GROUP BY endpoint) p ' +
        'ON p.endpoint = h.endpoint ' +
        'ORDER BY h.hits DESC',
    )
    .all();
  return rows.map((row) => ({
    endpoint: row.endpoint,
    hits: row.hits,
    paidCount: row.paidCount,
    conversion: row.hits > 0 ? row.paidCount / row.hits : 0,
  }));
}

export function registerAdminHitsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, config } = deps;
  app.get('/v1/admin/hits/summary', async (req) => {
    const { account } = authenticate(req, db);
    if (account.address.toLowerCase() !== config.merchantAddress.toLowerCase()) {
      throw new HttpError(403, 'forbidden', 'hits summary is merchant-only');
    }
    return { summary: hitsSummary(db) };
  });
}
