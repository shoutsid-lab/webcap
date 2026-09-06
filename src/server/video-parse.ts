import { isRecord, parseOptions, validatedUrl } from './capture-parse.js';
import { unprocessable } from '../util/errors.js';
import {
  VIDEO_DEFAULT_DURATION_MS,
  VIDEO_DEFAULT_SCROLL_SPEED,
  VIDEO_MAX_DURATION_MS,
  VIDEO_MAX_SCROLL_SPEED,
  type ScrollEasing,
  type VideoFormat,
} from '../capture/video.js';

export type { ScrollEasing, VideoFormat };

export interface VideoRequest {
  readonly url: string;
  readonly format: VideoFormat;
  readonly durationMs: number;
  readonly scrollSpeed: number;
  readonly scrollEasing: ScrollEasing;
  readonly viewport?: { readonly width: number; readonly height: number };
}

const DEFAULT_VIDEO_FORMAT: VideoFormat = 'mp4';

const DEFAULT_SCROLL_EASING: ScrollEasing = 'linear';

function parseVideoFormat(raw: unknown): VideoFormat {
  if (raw === undefined) return DEFAULT_VIDEO_FORMAT;
  if (raw === 'mp4' || raw === 'webm') return raw;
  throw unprocessable(`unsupported video format: ${String(raw)}`);
}

function parseDurationMs(raw: unknown): number {
  if (raw === undefined) return VIDEO_DEFAULT_DURATION_MS;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
    throw unprocessable('durationMs must be a positive integer');
  }
  if (raw > VIDEO_MAX_DURATION_MS) {
    throw unprocessable(`durationMs must not exceed ${VIDEO_MAX_DURATION_MS}`);
  }
  return raw;
}

function parseScrollSpeed(raw: unknown): number {
  if (raw === undefined) return VIDEO_DEFAULT_SCROLL_SPEED;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
    throw unprocessable('scrollSpeed must be a positive integer');
  }
  return Math.min(raw, VIDEO_MAX_SCROLL_SPEED);
}

function parseScrollEasing(raw: unknown): ScrollEasing {
  if (raw === undefined) return DEFAULT_SCROLL_EASING;
  if (raw === 'linear' || raw === 'ease-in-out') return raw;
  throw unprocessable('scrollEasing must be one of linear, ease-in-out');
}

export function parseVideoRequest(body: unknown, allowHosts: readonly string[] | undefined): VideoRequest {
  if (!isRecord(body)) throw unprocessable('body must be an object');
  const rawUrl = body.url;
  if (typeof rawUrl !== 'string') throw unprocessable('url is required');
  const url = validatedUrl(rawUrl, allowHosts);
  const format = parseVideoFormat(body.format);
  const durationMs = parseDurationMs(body.durationMs);
  const scrollSpeed = parseScrollSpeed(body.scrollSpeed);
  const scrollEasing = parseScrollEasing(body.scrollEasing);
  const viewport = parseOptions(body)?.viewport;
  return {
    url,
    format,
    durationMs,
    scrollSpeed,
    scrollEasing,
    ...(viewport !== undefined ? { viewport } : {}),
  };
}
