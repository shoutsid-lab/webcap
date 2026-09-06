import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from './index.js';
import { nowIso } from '../util/time.js';

export interface HitInput {
  readonly endpoint: string;
  readonly status: number;
  readonly payer?: string | undefined;
}

export interface HitRow {
  readonly id: number;
  readonly endpoint: string;
  readonly status: number;
  readonly payer_hash: string;
  readonly created_at: string;
}

export interface EndpointSummary {
  readonly endpoint: string;
  readonly hits: number;
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
}

export function makeHitsRepo(db: Db): HitsRepo {
  const insertHit = db.prepare<[string, number, string, string], unknown>(
    'INSERT INTO endpoint_hits (endpoint, status, payer_hash, created_at) VALUES (?, ?, ?, ?)',
  );
  const summarize = db.prepare<[number], EndpointSummary>(
    'SELECT endpoint, COUNT(*) AS hits FROM endpoint_hits GROUP BY endpoint ORDER BY hits DESC LIMIT ?',
  );
  return {
    record(hit: HitInput): void {
      insertHit.run(hit.endpoint, hit.status, hashPayer(hit.payer), nowIso());
    },
    summary(limit = 100): EndpointSummary[] {
      return summarize.all(limit);
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
 * endpoint_hits row (normalized endpoint, status, hashed payer),
 * fire-and-forget — a throwing write path never 500s a paid request.
 */
export function registerHitsHook(app: FastifyInstance, db: Db): void {
  app.addHook('onResponse', (_req, _reply, done) => {
    try {
      const req = _req as FastifyRequest;
      const replyStatus = (_reply as { statusCode?: unknown }).statusCode;
      const routePath = req.routeOptions?.url ?? req.url;
      recordHit(db, {
        endpoint: normalizeEndpoint(req.method, routePath),
        status: typeof replyStatus === 'number' ? replyStatus : 0,
        payer: hookPayer(req),
      });
    } catch {
      // Zero-risk on the hot path: the hit is telemetry, the response already settled.
    }
    done();
  });
}
