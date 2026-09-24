import { unprocessable } from '../util/errors.js';
import { isRecord, validatedUrl } from './capture-parse.js';

// Context-auth parsing lives in capture-parse.ts (shared with the ad-hoc
// `options.auth` field); re-exported here so existing importers keep working.
export {
  parseWatchAuth,
  WATCH_AUTH_HEADER_ALLOWLIST,
  type WatchAuth,
  type WatchCookie,
} from './capture-parse.js';

/**
 * Login-macro step parsing (validation only — T6 owns
 * scheduler/store/schema, routes are untouched).
 *
 * - parseMacroSteps: the bounded pre-shot step list (click/type/wait plus
 *   goto for login flows). Every goto URL passes through validatedUrl, so the
 *   SSRF guard applies per step, not just to the top-level capture URL.
 * - parseWatchAuth et al: re-exported from capture-parse.ts (shared with the
 *   ad-hoc `options.auth` field). Secrets stay out of logs via the redact
 *   paths in src/server/logging.ts and redactSecrets in src/util/redact.ts.
 */

export const MAX_MACRO_STEPS = 5;

const MACRO_WAIT_TIMEOUT_CAP_MS = 10_000;

export type MacroStep =
  | { readonly type: 'click'; readonly selector: string }
  | { readonly type: 'type'; readonly selector: string; readonly text: string }
  | { readonly type: 'wait'; readonly timeoutMs: number }
  | { readonly type: 'goto'; readonly url: string };

function parseMacroPositiveCappedInt(value: unknown, field: string, cap: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw unprocessable(`${field} must be a positive integer`);
  }
  return Math.min(value, cap);
}

function parseMacroStep(raw: unknown, allowHosts: readonly string[] | undefined): MacroStep {
  if (!isRecord(raw)) throw unprocessable('macro steps must be click/type/wait/goto objects');
  const { type } = raw;
  if (type === 'click' || type === 'type') {
    const { selector } = raw;
    if (typeof selector !== 'string' || selector.trim() === '') {
      throw unprocessable(`macro ${type} step requires a non-empty selector`);
    }
    if (type === 'click') return { type: 'click', selector: selector.trim() };
    const { text } = raw;
    if (typeof text !== 'string' || text === '') throw unprocessable('macro type step requires non-empty text');
    return { type: 'type', selector: selector.trim(), text };
  }
  if (type === 'wait') {
    if (raw.timeoutMs === undefined) throw unprocessable('macro wait step requires timeoutMs');
    return {
      type: 'wait',
      timeoutMs: parseMacroPositiveCappedInt(raw.timeoutMs, 'macro wait step timeoutMs', MACRO_WAIT_TIMEOUT_CAP_MS),
    };
  }
  if (type === 'goto') {
    const { url } = raw;
    if (typeof url !== 'string' || url.trim() === '') {
      throw unprocessable('macro goto step requires a non-empty url');
    }
    return { type: 'goto', url: validatedUrl(url.trim(), allowHosts) };
  }
  throw unprocessable('macro step type must be one of click, type, wait, goto');
}

/** Parse + validate a login-macro step list (1..MAX_MACRO_STEPS); goto URLs are SSRF-checked. */
export function parseMacroSteps(raw: unknown, allowHosts: readonly string[] | undefined): readonly MacroStep[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MACRO_STEPS) {
    throw unprocessable(`macro steps must be an array of 1 to ${MAX_MACRO_STEPS} click/type/wait/goto objects`);
  }
  return raw.map((step) => parseMacroStep(step, allowHosts));
}
