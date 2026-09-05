import type { Db } from './index.js';

export interface RevenueRow {
  readonly id: number;
  readonly endpoint: string;
  readonly payer: string;
  readonly revenue_usdc: number;
  readonly cost_usdc: number;
  readonly net_margin_usdc: number;
  readonly created_at: string;
}

export interface RevenueEntry {
  readonly endpoint: string;
  readonly payer: string;
  readonly revenueUsdcUnits: number;
  readonly costUsdcUnits: number;
}

export interface RevenueSummary {
  readonly totalRevenueUsdcUnits: number;
  readonly totalCostUsdcUnits: number;
  readonly netMarginUsdcUnits: number;
  readonly requestCount: number;
  readonly coveringCompute: boolean;
}

export interface RevenueRepo {
  /** Record one paid request's revenue vs. compute cost (net margin = revenue - cost). */
  record(entry: RevenueEntry): void;
  /** Aggregate the P&L: totals, request count, and whether margin covers compute. */
  summary(): RevenueSummary;
  /** The most recent ledger rows, newest first. */
  recent(limit: number): RevenueRow[];
}

const now = (): string => new Date().toISOString();

export function makeRevenueRepo(db: Db): RevenueRepo {
  const insertRow = db.prepare<[string, string, number, number, number, string], unknown>(
    'INSERT INTO revenue_ledger (endpoint, payer, revenue_usdc, cost_usdc, net_margin_usdc, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const aggregate = db.prepare<[], { total: number; cost: number; count: number }>(
    'SELECT COALESCE(SUM(revenue_usdc), 0) AS total, COALESCE(SUM(cost_usdc), 0) AS cost, COUNT(*) AS count FROM revenue_ledger',
  );
  const recentRows = db.prepare<[number], RevenueRow>(
    'SELECT id, endpoint, payer, revenue_usdc, cost_usdc, net_margin_usdc, created_at FROM revenue_ledger ORDER BY id DESC LIMIT ?',
  );

  return {
    record(entry: RevenueEntry): void {
      insertRow.run(
        entry.endpoint,
        entry.payer,
        entry.revenueUsdcUnits,
        entry.costUsdcUnits,
        entry.revenueUsdcUnits - entry.costUsdcUnits,
        now(),
      );
    },
    summary(): RevenueSummary {
      const row = aggregate.get() ?? { total: 0, cost: 0, count: 0 };
      const net = row.total - row.cost;
      return {
        totalRevenueUsdcUnits: row.total,
        totalCostUsdcUnits: row.cost,
        netMarginUsdcUnits: net,
        requestCount: row.count,
        coveringCompute: net >= 0,
      };
    },
    recent(limit: number): RevenueRow[] {
      return recentRows.all(limit);
    },
  };
}
