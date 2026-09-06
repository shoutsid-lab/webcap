import type { CaptureFormat, CaptureOptions } from '../capture/pipeline.js';
import { unprocessable } from '../util/errors.js';
import { validateCaptureUrl } from '../util/url.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
  if (
    timeoutMs === undefined &&
    fullPage === undefined &&
    viewport === undefined &&
    deviceScaleFactor === undefined &&
    isMobile === undefined &&
    userAgent === undefined
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
  };
}

export function validatedUrl(raw: string, allowHosts: readonly string[] | undefined): string {
  try {
    return validateCaptureUrl(raw, { allowHosts });
  } catch {
    throw unprocessable('invalid url');
  }
}
