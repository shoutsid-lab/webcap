/**
 * Injectable time sources for the watch scheduler: an epoch-ms clock and the
 * interval timers. Unit tests pass fakes; production wires the real ones via
 * startWatchScheduler() in src/main.ts.
 */
export interface WatchClock {
  /** Current time in epoch milliseconds. */
  nowMs(): number;
}

export interface WatchTimers {
  setInterval(callback: () => void, ms: number): NodeJS.Timeout;
  clearInterval(handle: NodeJS.Timeout): void;
}

export const defaultClock: WatchClock = { nowMs: () => Date.now() };
export const defaultTimers: WatchTimers = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle),
};
