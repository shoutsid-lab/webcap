/**
 * GET /v1/status — operational status dashboard endpoint.
 *
 * Returns a comprehensive, non-sensitive snapshot of the service:
 * - uptime, version, chain, DB health
 * - request counts and hit summary (top endpoints)
 * - revenue totals (aggregate only, no payer-identifiable data)
 * - active watch count
 *
 * This is a public endpoint designed for operational monitoring and
 * status pages. It exposes no secrets, no payer addresses, and no
 * individual transaction details.
 */
import type { FastifyInstance } from 'fastify';
import { CREDITS_PER_USDC, PRICE_PER_CREDIT, type WebcapConfig } from '../config.js';
import type { Db } from '../db/index.js';
import { makeRevenueRepo } from '../db/revenue.js';
import { makeHitsRepo } from '../db/hits.js';
import type { AppDeps } from './server.js';

const VERSION = '0.1.0';

export function registerStatusRoute(app: FastifyInstance, deps: AppDeps): void {
  const { db, config } = deps;
  const startTimeMs = deps.startTimeMs ?? Date.now();

  app.get('/v1/status', async () => {
    const uptimeSeconds = Math.floor((Date.now() - startTimeMs) / 1000);

    // DB health check — a lightweight query to confirm the DB is responsive
    let dbOk = true;
    try {
      db.prepare('SELECT 1').get();
    } catch {
      dbOk = false;
    }

    // Revenue summary (aggregate only — no individual transactions)
    const revenue = makeRevenueRepo(db);
    const revSummary = revenue.summary();

    // Top endpoints by hit count
    const hits = makeHitsRepo(db);
    const topEndpoints = hits.summary(10);

    // Active watch count
    let activeWatches = 0;
    try {
      const row = db.prepare('SELECT COUNT(*) AS cnt FROM watches WHERE paused = 0').get() as { cnt: number } | undefined;
      activeWatches = row?.cnt ?? 0;
    } catch {
      // watches table may not exist in test environments
    }

    // Total artifact count
    let artifactCount = 0;
    try {
      const row = db.prepare('SELECT COUNT(*) AS cnt FROM artifacts').get() as { cnt: number } | undefined;
      artifactCount = row?.cnt ?? 0;
    } catch {
      // artifacts table may not exist in test environments
    }

    return {
      status: 'ok',
      uptimeSeconds,
      version: VERSION,
      chain: {
        id: config.chainId,
        name: config.chain.name,
        network: config.x402Network ?? 'local',
      },
      db: {
        ok: dbOk,
      },
      pricing: {
        creditsPerUsdc: CREDITS_PER_USDC,
        pricePerCredit: PRICE_PER_CREDIT,
      },
      revenue: {
        totalRevenueUsdcUnits: revSummary.totalRevenueUsdcUnits,
        totalCostUsdcUnits: revSummary.totalCostUsdcUnits,
        netMarginUsdcUnits: revSummary.netMarginUsdcUnits,
        requestCount: revSummary.requestCount,
      },
      endpoints: {
        topHits: topEndpoints,
      },
      watches: {
        active: activeWatches,
      },
      artifacts: {
        count: artifactCount,
      },
    };
  });
}
