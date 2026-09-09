import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from './index.js';
import { nowIso } from '../util/time.js';

export interface HitInput {
  readonly endpoint: string;
  readonly status: number;
  readonly payer?: string | undefined;
  readonly durationMs?: number | undefined;
}

export interface HitRow {
  readonly id: number;
  readonly endpoint: string;
  readonly status: number;
  readonly payer_hash: string;
  readonly duration_ms: number | null;
  readonly created_at: string;
}

export interface EndpointSummary {
  readonly endpoint: string;
  readonly hits: number;
}

export interface AnalyticsBucket {
  readonly time_bucket: string;
  readonly endpoint: string;
  readonly requests: number;
  readonly errors: number;
  readonly avg_duration_ms: number | null;
  readonly p95_duration_ms: number | null;
}

export interface AnalyticsSummary {
  readonly totalRequests: number;
  readonly totalErrors: number;
  readonly avgDurationMs: number | null;
  readonly hourly: AnalyticsBucket[];
  readonly topEndpoints: { endpoint: string; requests: number; avgDurationMs: number | null }[];
}

const ANONYMOUS = 'anonymous';

/** sha256 hex slice (16 chars) of the raw payer; never stores the raw value. */
export function hashPayer(payer: string | undefined): string {
  if (payer === undefined || payer === '') return ANONYMOUS;
  return createHash('sha256').update(payer, 'utf8').digest('hex').slice(0, 16);
}

/** Normalize to `METHOD /path`: strip query string, keep unknown paths verbatim. */
export function normalizeEndpoint(method: string, rawUrl: string): string {
  const path = rawUrl.split('?')[0] ?? rawUrl;
  const withSlash = path.startsWith('/') ? path : `/${path}`;
  return `${method} ${withSlash}`;
}

export interface HitsRepo {
  record(hit: HitInput): void;
  summary(limit?: number): EndpointSummary[];
  analytics(hoursBack?: number): AnalyticsSummary;
}

export function makeHitsRepo(db: Db): HitsRepo {
  const insertHit = db.prepare<[string, number, string, number | null, string], unknown>(
    'INSERT INTO endpoint_hits (endpoint, status, payer_hash, duration_ms, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const summarize = db.prepare<[number], EndpointSummary>(
    'SELECT endpoint, COUNT(*) AS hits FROM endpoint_hits GROUP BY endpoint ORDER BY hits DESC LIMIT ?',
  );
  return {
    record(hit: HitInput): void {
      insertHit.run(hit.endpoint, hit.status, hashPayer(hit.payer), hit.durationMs ?? null, nowIso());
    },
    summary(limit = 100): EndpointSummary[] {
      return summarize.all(limit);
    },
    analytics(hoursBack = 24): AnalyticsSummary {
      // Use direct queries since percentile_cont is not available in SQLite.
      // We'll aggregate manually for p95.
      const since = new Date(Date.now() - hoursBack * 3600_000).toISOString();
      const hourly = db
        .prepare<[string], AnalyticsBucket>(
          "SELECT " +
            "strftime('%Y-%m-%dT%H:00:00Z', created_at) AS time_bucket, " +
            'endpoint, ' +
            'COUNT(*) AS requests, ' +
            "SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS errors, " +
            'ROUND(AVG(duration_ms)) AS avg_duration_ms, ' +
            'NULL AS p95_duration_ms ' +
            'FROM endpoint_hits ' +
            'WHERE created_at >= ? ' +
            'GROUP BY time_bucket, endpoint ' +
            'ORDER BY time_bucket DESC, requests DESC',
        )
        .all(since);
      // Top endpoints by request count
      const topEndpoints = db
        .prepare<[string], { endpoint: string; requests: number; avgDurationMs: number | null }>(
          "SELECT endpoint, COUNT(*) AS requests, ROUND(AVG(duration_ms)) AS avgDurationMs " +
            'FROM endpoint_hits WHERE created_at >= ? ' +
            'GROUP BY endpoint ORDER BY requests DESC LIMIT 10',
        )
        .all(since);
      // Aggregate totals
      const totals = db
        .prepare<[string], { totalRequests: number; totalErrors: number; avgDurationMs: number | null }>(
          "SELECT COUNT(*) AS totalRequests, " +
            "SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS totalErrors, " +
            'ROUND(AVG(duration_ms)) AS avgDurationMs ' +
            'FROM endpoint_hits WHERE created_at >= ?',
        )
        .get(since);
      return {
        totalRequests: totals?.totalRequests ?? 0,
        totalErrors: totals?.totalErrors ?? 0,
        avgDurationMs: totals?.avgDurationMs ?? null,
        hourly,
        topEndpoints,
      };
    },
  };
}

/** One request → one row (endpoint, status, payer_hash, created_at). */
export function recordHit(db: Db, hit: HitInput): void {
  makeHitsRepo(db).record(hit);
}

/** Per-endpoint hit counts, most-hit first. */
export function summaryByEndpoint(db: Db, limit = 100): EndpointSummary[] {
  return makeHitsRepo(db).summary(limit);
}

function hookPayer(req: FastifyRequest): string | undefined {
  // Same source as x402Payer (src/server/x402.ts), inlined to avoid a
  // server→db import cycle: the settled x402 payment context, if any.
  const payload = req.x402Context?.paymentPayload?.payload;
  if (payload === undefined) return undefined;
  const auth = payload['authorization'];
  if (typeof auth !== 'object' || auth === null) return undefined;
  const from = (auth as { from?: unknown }).from;
  return typeof from === 'string' ? from : undefined;
}

/**
 * Additive, zero-risk onResponse hook: every settled request writes one
 * endpoint_hits row (normalized endpoint, status, hashed payer, duration_ms),
 * fire-and-forget — a throwing write path never 500s a paid request.
 */
export function registerHitsHook(app: FastifyInstance, db: Db): void {
  app.addHook('onResponse', (_req, _reply, done) => {
    try {
      const req = _req as FastifyRequest;
      const reply = _reply as { statusCode?: unknown; elapsedTime?: unknown };
      const replyStatus = reply.statusCode;
      const routePath = req.routeOptions?.url ?? req.url;
      const durationMs = typeof reply.elapsedTime === 'number' ? Math.round(reply.elapsedTime) : undefined;
      recordHit(db, {
        endpoint: normalizeEndpoint(req.method, routePath),
        status: typeof replyStatus === 'number' ? replyStatus : 0,
        payer: hookPayer(req),
        durationMs,
      });
    } catch {
      // Zero-risk on the hot path: the hit is telemetry, the response already settled.
    }
    done();
  });
}
