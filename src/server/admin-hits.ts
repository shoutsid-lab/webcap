/**
 * The merchant-only analytics and hits summary views:
 *
 * GET /v1/admin/hits/summary — per-endpoint hits joined with paid counts
 *   (conversion = paid/hits). Merchant-only via Bearer auth + address comparison.
 *
 * GET /v1/admin/analytics — time-series API usage analytics: hourly request
 *   counts, error rates, and latency over the last 24 hours (configurable via
 *   ?hours=N, max 168). Includes top-endpoint breakdown and aggregate totals.
 *
 * GET /v1/admin/waitlist — email waitlist entries for mailing list export.
 *   Merchant-only via Bearer auth + address comparison.
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.js';
import { HttpError } from '../util/errors.js';
import { authenticate } from './auth.js';
import { makeHitsRepo } from '../db/hits.js';
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

  /**
   * GET /v1/admin/analytics — time-series API usage analytics.
   * Merchant-only. Query param ?hours=N (default 24, max 168).
   * Returns hourly buckets with request counts, error rates, and latency,
   * plus top endpoints and aggregate totals.
   */
  app.get('/v1/admin/analytics', async (req) => {
    const { account } = authenticate(req, db);
    if (account.address.toLowerCase() !== config.merchantAddress.toLowerCase()) {
      throw new HttpError(403, 'forbidden', 'analytics is merchant-only');
    }
    const query = (req.query ?? {}) as Record<string, unknown>;
    let hoursBack = 24;
    if (typeof query.hours === 'string') {
      const parsed = Number.parseInt(query.hours, 10);
      if (Number.isInteger(parsed) && parsed > 0 && parsed <= 168) hoursBack = parsed;
    }
    const hits = makeHitsRepo(db);
    const analytics = hits.analytics(hoursBack);
    return {
      hoursBack,
      ...analytics,
    };
  });

  /**
   * GET /v1/admin/waitlist — email waitlist entries for mailing list export.
   * Merchant-only. Returns all waitlist_signup events with email, date, and count.
   * Query param ?format=json (default) or ?format=csv for CSV export.
   */
  app.get('/v1/admin/waitlist', async (req, reply) => {
    const { account } = authenticate(req, db);
    if (account.address.toLowerCase() !== config.merchantAddress.toLowerCase()) {
      throw new HttpError(403, 'forbidden', 'waitlist is merchant-only');
    }
    const query = (req.query ?? {}) as Record<string, unknown>;
    const format = typeof query.format === 'string' ? query.format : 'json';

    const rows = db
      .prepare<[], { meta_json: string; created_at: string }>(
        "SELECT meta_json, created_at FROM tracking_events WHERE event = 'waitlist_signup' ORDER BY created_at ASC",
      )
      .all();

    const entries = rows.map((row) => {
      let email = '';
      try {
        const meta = JSON.parse(row.meta_json ?? '{}') as { email?: string };
        email = meta.email ?? '';
      } catch { /* malformed meta */ }
      return { email, signedUpAt: row.created_at };
    });

    if (format === 'csv') {
      const csv = 'email,signedUpAt\n' + entries.map((e) => `${e.email},${e.signedUpAt}`).join('\n');
      reply.header('content-type', 'text/csv');
      reply.header('content-disposition', 'attachment; filename="waitlist.csv"');
      return csv;
    }

    return {
      total: entries.length,
      entries,
    };
  });
}
