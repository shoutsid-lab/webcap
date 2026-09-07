import type { CaptureAction, CaptureFormat, CaptureOptions, CaptureProxy } from '../capture/pipeline.js';
import { HttpError, unprocessable } from '../util/errors.js';
import { validateCaptureUrl } from '../util/url.js';
import { isRecord } from '../util/type-guards.js';

// Re-export for backward compatibility (many server modules import isRecord from here).
export { isRecord } from '../util/type-guards.js';

export function parseFormat(body: unknown): CaptureFormat {
  const raw = isRecord(body) ? body.format : undefined;
  if (raw === undefined) return 'png';
  if (raw === 'png' || raw === 'jpeg' || raw === 'pdf') return raw;
  throw unprocessable(`unsupported format: ${String(raw)}`);
}

const VIEWPORT_MIN_WIDTH = 320;
const VIEWPORT_MAX_WIDTH = 3840;
const VIEWPORT_MIN_HEIGHT = 320;
const VIEWPORT_MAX_HEIGHT = 2160;
const DEVICE_SCALE_FACTOR_MAX = 3;
const USER_AGENT_MAX_LENGTH = 1024;
const WAIT_FOR_TIMEOUT_CAP_MS = 10_000;
const MAX_ACTIONS = 5;

function clampInt(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function parseViewport(raw: Record<string, unknown>): { readonly width: number; readonly height: number } | undefined {
  const viewport = raw.viewport;
  if (viewport === undefined) return undefined;
  if (!isRecord(viewport)) throw unprocessable('viewport must be an object with integer width and height');
  const { width, height } = viewport;
  if (typeof width !== 'number' || !Number.isInteger(width)) {
    throw unprocessable('viewport.width must be an integer');
  }
  if (typeof height !== 'number' || !Number.isInteger(height)) {
    throw unprocessable('viewport.height must be an integer');
  }
  return {
    width: clampInt(width, VIEWPORT_MIN_WIDTH, VIEWPORT_MAX_WIDTH),
    height: clampInt(height, VIEWPORT_MIN_HEIGHT, VIEWPORT_MAX_HEIGHT),
  };
}

function parseProxy(raw: Record<string, unknown>): CaptureProxy | undefined {
  const proxy = raw.proxy;
  if (proxy === undefined) return undefined;
  if (proxy === 'auto' || proxy === 'stealth') return proxy;
  if (typeof proxy !== 'string' || proxy.trim() === '') throw unprocessable('proxy must be auto, stealth, or a proxy URL string');
  let url: URL;
  try {
    url = new URL(proxy.trim());
  } catch {
    throw unprocessable('proxy must be auto, stealth, or a proxy URL string');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw unprocessable('proxy must be auto, stealth, or a proxy URL string');
  }
  return proxy.trim();
}

function parsePositiveCappedInt(value: unknown, field: string, cap: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw unprocessable(`${field} must be a positive integer`);
  }
  return Math.min(value, cap);
}

function parseWaitFor(raw: Record<string, unknown>): CaptureOptions['waitFor'] {
  const waitFor = raw.waitFor;
  if (waitFor === undefined) return undefined;
  if (!isRecord(waitFor)) throw unprocessable('waitFor must be an object with a selector');
  const { selector, timeoutMs } = waitFor;
  if (typeof selector !== 'string' || selector.trim() === '') {
    throw unprocessable('waitFor.selector must be a non-empty string');
  }
  if (timeoutMs === undefined) return { selector: selector.trim() };
  return { selector: selector.trim(), timeoutMs: parsePositiveCappedInt(timeoutMs, 'waitFor.timeoutMs', WAIT_FOR_TIMEOUT_CAP_MS) };
}

function parseAction(raw: unknown): CaptureAction {
  if (!isRecord(raw)) throw unprocessable('actions must be click/type/wait objects');
  const { type } = raw;
  if (type === 'click' || type === 'type') {
    const { selector } = raw;
    if (typeof selector !== 'string' || selector.trim() === '') {
      throw unprocessable(`actions ${type} requires a non-empty selector`);
    }
    if (type === 'click') return { type: 'click', selector: selector.trim() };
    const { text } = raw;
    if (typeof text !== 'string' || text === '') throw unprocessable('actions type requires non-empty text');
    return { type: 'type', selector: selector.trim(), text };
  }
  if (type === 'wait') {
    if (raw.timeoutMs === undefined) throw unprocessable('actions wait requires timeoutMs');
    return { type: 'wait', timeoutMs: parsePositiveCappedInt(raw.timeoutMs, 'actions wait timeoutMs', WAIT_FOR_TIMEOUT_CAP_MS) };
  }
  throw unprocessable('actions type must be one of click, type, wait');
}

function parseActions(raw: Record<string, unknown>): readonly CaptureAction[] | undefined {
  const actions = raw.actions;
  if (actions === undefined) return undefined;
  if (!Array.isArray(actions) || actions.length === 0 || actions.length > MAX_ACTIONS) {
    throw unprocessable(`actions must be an array of 1 to ${MAX_ACTIONS} click/type/wait objects`);
  }
  return actions.map(parseAction);
}

export function parseOptions(body: unknown): CaptureOptions | undefined {
  const raw = isRecord(body) ? body.options : undefined;
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) throw unprocessable('options must be an object');
  const timeoutMs = raw.timeoutMs;
  const fullPage = raw.fullPage;
  if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs <= 0)) {
    throw unprocessable('timeoutMs must be a positive integer');
  }
  if (fullPage !== undefined && typeof fullPage !== 'boolean') {
    throw unprocessable('fullPage must be a boolean');
  }
  const hasViewport = raw.viewport !== undefined;
  const viewport = hasViewport ? parseViewport(raw) : undefined;
  const deviceScaleFactorRaw = raw.deviceScaleFactor;
  let deviceScaleFactor: number | undefined;
  if (deviceScaleFactorRaw !== undefined) {
    if (
      typeof deviceScaleFactorRaw !== 'number' ||
      !Number.isFinite(deviceScaleFactorRaw) ||
      deviceScaleFactorRaw <= 0
    ) {
      throw unprocessable('deviceScaleFactor must be a positive number');
    }
    deviceScaleFactor = Math.min(deviceScaleFactorRaw, DEVICE_SCALE_FACTOR_MAX);
  }
  const isMobile = raw.isMobile;
  if (isMobile !== undefined && typeof isMobile !== 'boolean') {
    throw unprocessable('isMobile must be a boolean');
  }
  const userAgentRaw = raw.userAgent;
  if (userAgentRaw !== undefined && typeof userAgentRaw !== 'string') {
    throw unprocessable('userAgent must be a string');
  }
  const userAgentTrimmed = typeof userAgentRaw === 'string' ? userAgentRaw.trim() : undefined;
  if (userAgentRaw !== undefined && (userAgentTrimmed === undefined || userAgentTrimmed === '')) {
    throw unprocessable('userAgent must be a non-empty string');
  }
  const userAgent =
    userAgentTrimmed === undefined ? undefined : userAgentTrimmed.slice(0, USER_AGENT_MAX_LENGTH);
  const proxy = parseProxy(raw);
  const waitFor = parseWaitFor(raw);
  const actions = parseActions(raw);
  if (
    timeoutMs === undefined &&
    fullPage === undefined &&
    viewport === undefined &&
    deviceScaleFactor === undefined &&
    isMobile === undefined &&
    userAgent === undefined &&
    proxy === undefined &&
    waitFor === undefined &&
    actions === undefined
  ) {
    return undefined;
  }
  return {
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(fullPage !== undefined ? { fullPage } : {}),
    ...(viewport !== undefined ? { viewport } : {}),
    ...(deviceScaleFactor !== undefined ? { deviceScaleFactor } : {}),
    ...(isMobile !== undefined ? { isMobile } : {}),
    ...(userAgent !== undefined ? { userAgent } : {}),
    ...(proxy !== undefined ? { proxy } : {}),
    ...(waitFor !== undefined ? { waitFor } : {}),
    ...(actions !== undefined ? { actions } : {}),
  };
}

export function validatedUrl(raw: string, allowHosts: readonly string[] | undefined): string {
  try {
    return validateCaptureUrl(raw, { allowHosts });
  } catch (err) {
    const reason = err instanceof HttpError ? err.message : 'invalid url';
    if (reason.includes('not allowed')) {
      throw unprocessable('invalid url', { reason, dnsRebindingCaveat: true });
    }
    throw unprocessable('invalid url');
  }
}
