/**
 * The watch interval vocabulary: the fixed cadences a watch can run on
 * ('15m' | '1h' | '6h' | '24h') and their millisecond widths. Shared by the
 * HTTP layer (src/server/watches.ts validates the field) and the scheduler
 * (src/watch/scheduler.ts advances next_run_at).
 */
export type WatchEvery = '15m' | '1h' | '6h' | '24h';
export const WATCH_EVERIES: readonly WatchEvery[] = ['15m', '1h', '6h', '24h'];
const EVERY_MS: Record<WatchEvery, number> = {
  '15m': 15 * 60_000,
  '1h': 3_600_000,
  '6h': 21_600_000,
  '24h': 86_400_000,
};

export function everyMsOf(every: string): number {
  if (every === '15m') return EVERY_MS['15m'];
  if (every === '1h') return EVERY_MS['1h'];
  if (every === '6h') return EVERY_MS['6h'];
  if (every === '24h') return EVERY_MS['24h'];
  throw new Error(`unknown watch interval: ${every}`);
}
