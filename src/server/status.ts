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

    // Latency summary (last 1 hour for the status dashboard)
    let avgDurationMs: number | null = null;
    let p50DurationMs: number | null = null;
    let errorRate: number | null = null;
    let errorBreakdown: { statusCode: number; count: number; endpoints: string[] }[] = [];
    try {
      const since = new Date(Date.now() - 3600_000).toISOString();
      const latencyRow = db
        .prepare<[string], { avgDurationMs: number | null; totalRequests: number; errorCount: number }>(
          "SELECT " +
            'ROUND(AVG(duration_ms)) AS avgDurationMs, ' +
            'COUNT(*) AS totalRequests, ' +
            "SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS errorCount " +
            'FROM endpoint_hits WHERE created_at >= ?',
        )
        .get(since);
      if (latencyRow !== undefined) {
        avgDurationMs = latencyRow.avgDurationMs;
        errorRate = latencyRow.totalRequests > 0
          ? Math.round((latencyRow.errorCount / latencyRow.totalRequests) * 10000) / 100
          : 0;
      }
      // P50 via sorted median query
      const p50Row = db
        .prepare<[string, string], { p50: number | null }>(
          "SELECT duration_ms AS p50 FROM endpoint_hits " +
            'WHERE created_at >= ? AND duration_ms IS NOT NULL ' +
            'ORDER BY duration_ms LIMIT 1 OFFSET (SELECT COUNT(*) / 2 FROM endpoint_hits WHERE created_at >= ? AND duration_ms IS NOT NULL)',
        )
        .get(since, since);
      p50DurationMs = p50Row?.p50 ?? null;

      // Error breakdown: group 5xx errors by status code with affected endpoints
      const errorRows = db
        .prepare<[string], { status: number; count: number; endpoints: string }>(
          "SELECT status, COUNT(*) AS count, GROUP_CONCAT(DISTINCT endpoint) AS endpoints " +
            'FROM endpoint_hits WHERE created_at >= ? AND status >= 500 ' +
            'GROUP BY status ORDER BY count DESC',
        )
        .all(since);
      errorBreakdown = errorRows.map((r) => ({
        statusCode: r.status,
        count: r.count,
        endpoints: r.endpoints ? r.endpoints.split(',') : [],
      }));
    } catch {
      // Latency stats are best-effort; don't fail the status endpoint
    }

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

    // Waitlist count
    let waitlistCount = 0;
    try {
      const row = db.prepare(
        "SELECT COUNT(*) AS cnt FROM tracking_events WHERE event = 'waitlist_signup'",
      ).get() as { cnt: number } | undefined;
      waitlistCount = row?.cnt ?? 0;
    } catch {
      // tracking_events table may not exist
    }

    // Conversion funnel (last 24h) from tracking_events
    let funnel: Record<string, number> = {};
    let funnelStructured: {
      stage: string;
      count: number;
      conversionFromPrev: number | null;
    }[] = [];
    let funnelHourly: { hour: string; events: Record<string, number> }[] = [];
    let funnelReferrers: { referrer: string; count: number }[] = [];
    let funnelErrorBreakdown: { errorType: string; count: number; sampleUrls: string[] }[] = [];
    try {
      const since24h = new Date(Date.now() - 86400_000).toISOString();
      const rows = db
        .prepare<[string], { event: string; cnt: number }>(
          'SELECT event, COUNT(*) AS cnt FROM tracking_events WHERE created_at >= ? GROUP BY event',
        )
        .all(since24h);
      for (const row of rows) {
        funnel[row.event] = row.cnt;
      }

      // Structured funnel with conversion rates between stages
      // preview_error is a sibling of preview_success (both from preview_try), not sequential
      const funnelStages = [
        { event: 'landing_view', label: 'page_view' },
        { event: 'preview_submit', label: 'preview_try' },
        { event: 'preview_result_success', label: 'preview_success' },
        { event: 'preview_result_error', label: 'preview_error', skipConversion: true },
        { event: 'upgrade_click', label: 'upgrade_click' },
        { event: 'curl_copy', label: 'curl_copy' },
        { event: 'email_subscribe', label: 'email_subscribe' },
        { event: 'cta_click', label: 'cta_click' },
      ];
      let prevCount = 0;
      for (const stage of funnelStages) {
        const count = funnel[stage.event] ?? 0;
        funnelStructured.push({
          stage: stage.label,
          count,
          conversionFromPrev: stage.skipConversion
            ? null
            : prevCount > 0 ? Math.round((count / prevCount) * 10000) / 100 : null,
        });
        if (!stage.skipConversion) prevCount = count;
      }

      // Hourly breakdown for trend analysis
      const hourlyRows = db
        .prepare<[string], { hour: string; event: string; cnt: number }>(
          "SELECT strftime('%Y-%m-%dT%H:00:00Z', created_at) AS hour, event, COUNT(*) AS cnt " +
            'FROM tracking_events WHERE created_at >= ? GROUP BY hour, event ORDER BY hour',
        )
        .all(since24h);
      const hourlyMap = new Map<string, Record<string, number>>();
      for (const row of hourlyRows) {
        if (!hourlyMap.has(row.hour)) hourlyMap.set(row.hour, {});
        hourlyMap.get(row.hour)![row.event] = row.cnt;
      }
      funnelHourly = Array.from(hourlyMap.entries()).map(([hour, events]) => ({ hour, events }));

      // Referrer breakdown
      const refRows = db
        .prepare<[string | null, string], { referrer: string | null; cnt: number }>(
          "SELECT CASE WHEN meta_json LIKE '%\"direct\"%' THEN 'direct' " +
            "WHEN meta_json LIKE '%ycombinator%' THEN 'hacker_news' " +
            "WHEN meta_json LIKE '%reddit%' THEN 'reddit' " +
            "WHEN meta_json LIKE '%twitter%' OR meta_json LIKE '%x.com%' THEN 'twitter' " +
            "WHEN meta_json IS NOT NULL AND meta_json != '' THEN 'other' " +
            "ELSE 'unknown' END AS referrer, COUNT(*) AS cnt " +
            'FROM tracking_events WHERE event = ? AND created_at >= ? GROUP BY referrer ORDER BY cnt DESC',
        )
        .all('landing_view', since24h);
      funnelReferrers = refRows.map((r) => ({ referrer: r.referrer ?? 'unknown', count: r.cnt }));

      // Error type breakdown from preview_result_error events
      try {
        const errorRows = db
          .prepare<[string], { meta_json: string }>(
            "SELECT meta_json FROM tracking_events WHERE event = 'preview_result_error' AND created_at >= ?",
          )
          .all(since24h);
        const errorMap = new Map<string, { count: number; urls: Set<string> }>();
        for (const row of errorRows) {
          try {
            const meta = JSON.parse(row.meta_json || '{}');
            const errorMsg = String(meta.error || 'unknown');
            // Use pre-categorized errorType from client if available, otherwise categorize server-side
            let errorType = typeof meta.errorType === 'string' ? meta.errorType : 'other';
            if (errorType === 'other') {
              if (errorMsg.indexOf('502') !== -1) errorType = 'capture_failed_502';
              else if (errorMsg.indexOf('429') !== -1 || errorMsg.indexOf('rate') !== -1) errorType = 'rate_limited';
              else if (errorMsg.indexOf('Failed to fetch') !== -1 || errorMsg.indexOf('AbortError') !== -1) errorType = 'network_timeout';
              else if (errorMsg.indexOf('404') !== -1) errorType = 'not_found';
              else if (errorMsg.indexOf('422') !== -1) errorType = 'invalid_url';
              else if (errorMsg.indexOf('403') !== -1) errorType = 'blocked';
            }
            if (!errorMap.has(errorType)) errorMap.set(errorType, { count: 0, urls: new Set() });
            const entry = errorMap.get(errorType)!;
            entry.count++;
            if (meta.url) entry.urls.add(meta.url);
          } catch { /* skip malformed meta */ }
        }
        funnelErrorBreakdown = Array.from(errorMap.entries()).map(([errorType, data]) => ({
          errorType,
          count: data.count,
          sampleUrls: Array.from(data.urls).slice(0, 3),
        })).sort((a, b) => b.count - a.count);
      } catch { /* tracking_events may not exist */ }
    } catch {
      // tracking_events table may not exist yet
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
      performance: {
        avgDurationMs,
        p50DurationMs,
        errorRate,
        errorBreakdown,
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
      waitlist: {
        count: waitlistCount,
      },
      funnel,
      funnelStructured,
      funnelHourly,
      funnelReferrers,
      funnelErrorBreakdown,
    };
  });

  /**
   * GET /v1/funnel — dedicated funnel analytics endpoint.
   * Returns structured conversion funnel, hourly breakdown, and referrer data.
   * ?format=text for human-readable terminal output (no jq needed).
   */
  app.get('/v1/funnel', async (req, reply) => {
    const query = req.query as Record<string, unknown>;
    const fmt = typeof query.format === 'string' ? query.format : 'json';

    let funnel: Record<string, number> = {};
    let funnelStructured: {
      stage: string;
      count: number;
      conversionFromPrev: number | null;
    }[] = [];
    let funnelHourly: { hour: string; events: Record<string, number> }[] = [];
    let funnelReferrers: { referrer: string; count: number }[] = [];
    let errorBreakdown: { errorType: string; count: number; sampleUrls: string[] }[] = [];
    let waitlistCount = 0;

    try {
      const since24h = new Date(Date.now() - 86400_000).toISOString();

      // Raw event counts
      const rows = db
        .prepare<[string], { event: string; cnt: number }>(
          'SELECT event, COUNT(*) AS cnt FROM tracking_events WHERE created_at >= ? GROUP BY event',
        )
        .all(since24h);
      for (const row of rows) {
        funnel[row.event] = row.cnt;
      }

      // Structured funnel with conversion rates
      const funnelStages = [
        { event: 'landing_view', label: 'page_view' },
        { event: 'preview_submit', label: 'preview_try' },
        { event: 'preview_result_success', label: 'preview_success' },
        { event: 'preview_result_error', label: 'preview_error', skipConversion: true },
        { event: 'upgrade_click', label: 'upgrade_click' },
        { event: 'curl_copy', label: 'curl_copy' },
        { event: 'email_subscribe', label: 'email_subscribe' },
        { event: 'cta_click', label: 'cta_click' },
      ];
      let prevCount = 0;
      for (const stage of funnelStages) {
        const count = funnel[stage.event] ?? 0;
        funnelStructured.push({
          stage: stage.label,
          count,
          conversionFromPrev: stage.skipConversion
            ? null
            : prevCount > 0 ? Math.round((count / prevCount) * 10000) / 100 : null,
        });
        if (!stage.skipConversion) prevCount = count;
      }

      // Hourly breakdown
      const hourlyRows = db
        .prepare<[string], { hour: string; event: string; cnt: number }>(
          "SELECT strftime('%Y-%m-%dT%H:00:00Z', created_at) AS hour, event, COUNT(*) AS cnt " +
            'FROM tracking_events WHERE created_at >= ? GROUP BY hour, event ORDER BY hour',
        )
        .all(since24h);
      const hourlyMap = new Map<string, Record<string, number>>();
      for (const row of hourlyRows) {
        if (!hourlyMap.has(row.hour)) hourlyMap.set(row.hour, {});
        hourlyMap.get(row.hour)![row.event] = row.cnt;
      }
      funnelHourly = Array.from(hourlyMap.entries()).map(([hour, events]) => ({ hour, events }));

      // Referrer breakdown
      const refRows = db
        .prepare<[string | null, string], { referrer: string | null; cnt: number }>(
          "SELECT CASE WHEN meta_json LIKE '%\"direct\"%' THEN 'direct' " +
            "WHEN meta_json LIKE '%ycombinator%' THEN 'hacker_news' " +
            "WHEN meta_json LIKE '%reddit%' THEN 'reddit' " +
            "WHEN meta_json LIKE '%twitter%' OR meta_json LIKE '%x.com%' THEN 'twitter' " +
            "WHEN meta_json IS NOT NULL AND meta_json != '' THEN 'other' " +
            "ELSE 'unknown' END AS referrer, COUNT(*) AS cnt " +
            'FROM tracking_events WHERE event = ? AND created_at >= ? GROUP BY referrer ORDER BY cnt DESC',
        )
        .all('landing_view', since24h);
      funnelReferrers = refRows.map((r) => ({ referrer: r.referrer ?? 'unknown', count: r.cnt }));

      // Error type breakdown from preview_result_error events
      try {
        const errorRows = db
          .prepare<[string], { meta_json: string }>(
            "SELECT meta_json FROM tracking_events WHERE event = 'preview_result_error' AND created_at >= ?",
          )
          .all(since24h);
        const errorMap = new Map<string, { count: number; urls: Set<string> }>();
        for (const row of errorRows) {
          try {
            const meta = JSON.parse(row.meta_json || '{}');
            const errorMsg = String(meta.error || 'unknown');
            // Categorize the error type
            let errorType = 'other';
            if (errorMsg.indexOf('502') !== -1) errorType = 'capture_failed_502';
            else if (errorMsg.indexOf('429') !== -1 || errorMsg.indexOf('rate') !== -1) errorType = 'rate_limited';
            else if (errorMsg.indexOf('Failed to fetch') !== -1 || errorMsg.indexOf('AbortError') !== -1) errorType = 'network_timeout';
            else if (errorMsg.indexOf('404') !== -1) errorType = 'not_found';
            else if (errorMsg.indexOf('422') !== -1) errorType = 'invalid_url';
            else if (errorMsg.indexOf('403') !== -1) errorType = 'blocked';

            if (!errorMap.has(errorType)) errorMap.set(errorType, { count: 0, urls: new Set() });
            const entry = errorMap.get(errorType)!;
            entry.count++;
            if (meta.url) entry.urls.add(meta.url);
          } catch { /* skip malformed meta */ }
        }
        errorBreakdown = Array.from(errorMap.entries()).map(([errorType, data]) => ({
          errorType,
          count: data.count,
          sampleUrls: Array.from(data.urls).slice(0, 3),
        })).sort((a, b) => b.count - a.count);
      } catch { /* tracking_events may not exist */ }

      // Waitlist count
      const wlRow = db.prepare(
        "SELECT COUNT(*) AS cnt FROM tracking_events WHERE event = 'waitlist_signup'",
      ).get() as { cnt: number } | undefined;
      waitlistCount = wlRow?.cnt ?? 0;
    } catch {
      // tracking_events table may not exist
    }

    // Text format for terminal-friendly output (no jq needed)
    if (fmt === 'text') {
      reply.header('content-type', 'text/plain; charset=utf-8');
      const lines: string[] = [];
      lines.push('=== WEBCAP FUNNEL (last 24h) ===');
      lines.push('');
      lines.push('CONVERSION FUNNEL:');
      for (const s of funnelStructured) {
        const conv = s.conversionFromPrev !== null ? ` (${s.conversionFromPrev}%)` : '';
        lines.push(`  ${s.stage.padEnd(20)} ${String(s.count).padStart(6)}${conv}`);
      }
      lines.push('');
      lines.push('HOURLY BREAKDOWN:');
      for (const h of funnelHourly) {
        const events = Object.entries(h.events).map(([k, v]) => `${k}=${v}`).join(' ');
        lines.push(`  ${h.hour}  ${events}`);
      }
      lines.push('');
      lines.push('REFERRERS (from landing_view):');
      for (const r of funnelReferrers) {
        lines.push(`  ${r.referrer.padEnd(16)} ${r.count}`);
      }
      if (errorBreakdown.length > 0) {
        lines.push('');
        lines.push('PREVIEW ERRORS (by type):');
        for (const e of errorBreakdown) {
          const urls = e.sampleUrls.length > 0 ? ` (e.g. ${e.sampleUrls[0]})` : '';
          lines.push(`  ${e.errorType.padEnd(24)} ${String(e.count).padStart(4)}${urls}`);
        }
      }
      if (waitlistCount > 0) {
        lines.push('');
        lines.push(`WAITLIST SIGNUPS: ${waitlistCount}`);
      }
      lines.push('');
      lines.push(`Generated: ${new Date().toISOString()}`);
      return reply.send(lines.join('\n'));
    }

    return {
      generatedAt: new Date().toISOString(),
      waitlistCount,
      funnel,
      funnelStructured,
      funnelHourly,
      funnelReferrers,
      errorBreakdown,
    };
  });

  // shields.io-compatible status badge endpoint
  app.get('/v1/status-badge', async () => {
    let dbOk = true;
    try {
      db.prepare('SELECT 1').get();
    } catch {
      dbOk = false;
    }

    const isOk = dbOk;
    const schemaVersion = 1;

    return {
      schemaVersion,
      label: 'API Status',
      message: isOk ? 'operational' : 'degraded',
      color: isOk ? 'brightgreen' : 'yellow',
    };
  });
}
