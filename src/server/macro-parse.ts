import { unprocessable } from '../util/errors.js';
import { isRecord, validatedUrl } from './capture-parse.js';

/**
 * Login-macro + per-watch context-auth parsing (validation only — T6 owns
 * scheduler/store/schema, routes are untouched).
 *
 * - parseMacroSteps: the bounded pre-shot step list (click/type/wait plus
 *   goto for login flows). Every goto URL passes through validatedUrl, so the
 *   SSRF guard applies per step, not just to the top-level capture URL.
 * - parseWatchAuth: per-watch browser-context auth — allowlisted extra headers
 *   plus structured cookies. Secrets stay out of logs via the redact paths in
 *   src/server/logging.ts and the redactSecrets helper in src/util/redact.ts.
 */

export const MAX_MACRO_STEPS = 5;

const MACRO_WAIT_TIMEOUT_CAP_MS = 10_000;
const HEADER_VALUE_MAX_LENGTH = 4096;
const COOKIE_VALUE_MAX_LENGTH = 4096;
const MAX_AUTH_COOKIES = 10;

export type MacroStep =
  | { readonly type: 'click'; readonly selector: string }
  | { readonly type: 'type'; readonly selector: string; readonly text: string }
  | { readonly type: 'wait'; readonly timeoutMs: number }
  | { readonly type: 'goto'; readonly url: string };

/** Per-watch extra-header allowlist (compared case-insensitively, stored as sent). */
export const WATCH_AUTH_HEADER_ALLOWLIST: readonly string[] = ['authorization', 'x-api-key'];

export interface WatchCookie {
  readonly name: string;
  readonly value: string;
  readonly domain?: string;
}

export interface WatchAuth {
  readonly headers?: Record<string, string>;
  readonly cookies?: readonly WatchCookie[];
}

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

function parseAuthHeaders(raw: Record<string, unknown>): Record<string, string> | undefined {
  const headers = raw.headers;
  if (headers === undefined) return undefined;
  if (!isRecord(headers)) throw unprocessable('auth headers must be an object of header name to value');
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!WATCH_AUTH_HEADER_ALLOWLIST.includes(name.toLowerCase())) {
      throw unprocessable(`auth header not allowed: ${name}`);
    }
    if (typeof value !== 'string' || value.trim() === '') {
      throw unprocessable(`auth header ${name} must be a non-empty string`);
    }
    out[name] = value.trim().slice(0, HEADER_VALUE_MAX_LENGTH);
  }
  return out;
}

function parseAuthCookie(raw: unknown): WatchCookie {
  if (!isRecord(raw)) throw unprocessable('auth cookies must be objects with name and value');
  const { name, value, domain } = raw;
  if (typeof name !== 'string' || name.trim() === '') {
    throw unprocessable('auth cookie requires a non-empty name');
  }
  if (typeof value !== 'string') throw unprocessable('auth cookie requires a string value');
  let domainOut: string | undefined;
  if (domain !== undefined) {
    if (typeof domain !== 'string' || domain.trim() === '') {
      throw unprocessable('auth cookie domain must be a non-empty string');
    }
    domainOut = domain.trim();
  }
  return {
    name: name.trim(),
    value: value.slice(0, COOKIE_VALUE_MAX_LENGTH),
    ...(domainOut !== undefined ? { domain: domainOut } : {}),
  };
}

function parseAuthCookies(raw: Record<string, unknown>): readonly WatchCookie[] | undefined {
  const cookies = raw.cookies;
  if (cookies === undefined) return undefined;
  if (!Array.isArray(cookies) || cookies.length === 0 || cookies.length > MAX_AUTH_COOKIES) {
    throw unprocessable(`auth cookies must be an array of 1 to ${MAX_AUTH_COOKIES} name/value objects`);
  }
  return cookies.map(parseAuthCookie);
}

/** Parse + validate per-watch context auth (undefined = no auth). */
export function parseWatchAuth(raw: unknown): WatchAuth | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) throw unprocessable('auth must be an object with headers and/or cookies');
  const headers = parseAuthHeaders(raw);
  const cookies = parseAuthCookies(raw);
  return {
    ...(headers !== undefined ? { headers } : {}),
    ...(cookies !== undefined ? { cookies } : {}),
  };
}
