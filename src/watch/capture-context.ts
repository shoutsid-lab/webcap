import type { ContextCookie } from '../capture/browser.js';
import type { CaptureAction, CaptureOptions } from '../capture/pipeline.js';
import type { WatchRow } from './store.js';

/**
 * Stored per-watch browser context (macro steps + auth) resolved from the
 * nullable JSON columns. Undefined when the watch stores nothing: callers
 * then issue the legacy bare capture/extract calls, byte-identical.
 */
export interface WatchCaptureContext {
  readonly actions?: readonly CaptureAction[];
  readonly headers?: Record<string, string>;
  readonly cookies?: readonly ContextCookie[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse one stored JSON column. Static failure (never echoes the stored
 * value, which may carry secrets) so the run error stays redaction-safe.
 */
function parseStoredJson(raw: string | null, column: string): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`watch ${column} invalid`);
  }
}

function parseStoredHeaders(raw: string | null): Record<string, string> | undefined {
  const parsed = parseStoredJson(raw, 'headers_json');
  if (parsed === undefined) return undefined;
  if (!isRecord(parsed)) throw new Error('watch headers_json invalid');
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') throw new Error('watch headers_json invalid');
    out[name] = value;
  }
  return out;
}

function parseStoredCookies(raw: string | null): readonly ContextCookie[] | undefined {
  const parsed = parseStoredJson(raw, 'cookies_json');
  if (parsed === undefined) return undefined;
  if (!Array.isArray(parsed)) throw new Error('watch cookies_json invalid');
  return parsed.map((entry) => {
    if (!isRecord(entry) || typeof entry['name'] !== 'string' || typeof entry['value'] !== 'string') {
      throw new Error('watch cookies_json invalid');
    }
    const domain = entry['domain'];
    if (domain !== undefined && typeof domain !== 'string') throw new Error('watch cookies_json invalid');
    return {
      name: entry['name'],
      value: entry['value'],
      ...(typeof domain === 'string' ? { domain } : {}),
    };
  });
}

function parseStoredAction(step: unknown): CaptureAction {
  if (!isRecord(step)) throw new Error('watch steps_json invalid');
  const type = step['type'];
  if (type === 'click' || type === 'type') {
    const selector = step['selector'];
    if (typeof selector !== 'string' || selector.trim() === '') throw new Error('watch steps_json invalid');
    if (type === 'click') return { type: 'click', selector: selector.trim() };
    const text = step['text'];
    if (typeof text !== 'string') throw new Error('watch steps_json invalid');
    return { type: 'type', selector: selector.trim(), text };
  }
  if (type === 'wait') {
    const timeoutMs = step['timeoutMs'];
    if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('watch steps_json invalid');
    }
    return { type: 'wait', timeoutMs };
  }
  if (type === 'goto') {
    const url = step['url'];
    if (typeof url !== 'string' || url.trim() === '') throw new Error('watch steps_json invalid');
    return { type: 'goto', url: url.trim() };
  }
  throw new Error('watch steps_json invalid');
}

function parseStoredActions(raw: string | null): readonly CaptureAction[] | undefined {
  const parsed = parseStoredJson(raw, 'steps_json');
  if (parsed === undefined) return undefined;
  if (!Array.isArray(parsed)) throw new Error('watch steps_json invalid');
  return parsed.map(parseStoredAction);
}

/**
 * Capture options for one due watch: macro steps become pre-shot actions,
 * stored auth becomes context headers/cookies. Throws (fail-closed into the
 * run's error path) on malformed stored JSON instead of silently dropping
 * auth the watch depends on.
 */
export function captureOptionsOf(watch: WatchRow): CaptureOptions | undefined {
  const actions = parseStoredActions(watch.steps_json);
  const headers = parseStoredHeaders(watch.headers_json);
  const cookies = parseStoredCookies(watch.cookies_json);
  if (actions === undefined && headers === undefined && cookies === undefined) return undefined;
  return {
    ...(actions !== undefined ? { actions } : {}),
    ...(headers !== undefined ? { extraHTTPHeaders: headers } : {}),
    ...(cookies !== undefined ? { cookies } : {}),
  };
}
