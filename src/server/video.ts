import type { FastifyInstance } from 'fastify';

import type { Db } from '../db/index.js';
import type { WebcapConfig } from '../config.js';
import { HttpError } from '../util/errors.js';
import { CaptureError, VideoBusyError } from '../capture/errors.js';
import { captureVideo } from '../capture/video.js';
import { parseVideoRequest } from './video-parse.js';
import { x402Payer } from './x402.js';

export interface VideoRouteDeps {
  readonly db: Db;
  readonly config: WebcapConfig;
  readonly captureAllowHosts?: readonly string[];
}

/**
 * Scroll-capture video route core (wiring lands with T8: x402 challenge entry,
 * route registration in server.ts, artifact persist via storeArtifact). This
 * module owns the handler only: parse -> record -> ledger -> artifact-ready
 * result (base64 data + mime, no persist here).
 */
export function registerVideoRoute(app: FastifyInstance, deps: VideoRouteDeps): void {
  const { config } = deps;
  const allowHosts = deps.captureAllowHosts;
  app.post('/v1/x402/video', async (req) => {
    if (config.x402Network === undefined) {
      throw new HttpError(503, 'x402_disabled', 'x402 payment requires WEBCAP_CHAIN=base-sepolia or base');
    }
    const parsed = parseVideoRequest(req.body, allowHosts);
    let result;
    try {
      result = await captureVideo({
        url: parsed.url,
        format: parsed.format,
        durationMs: parsed.durationMs,
        scrollSpeed: parsed.scrollSpeed,
        scrollEasing: parsed.scrollEasing,
        ...(parsed.viewport !== undefined ? { viewport: parsed.viewport } : {}),
      });
    } catch (err) {
      if (err instanceof VideoBusyError) throw new HttpError(429, err.code, err.message);
      if (err instanceof CaptureError) throw new HttpError(502, 'video_failed', err.message);
      throw err;
    }
    const payer = x402Payer(req) ?? 'unknown';
    (req as unknown as { _pendingRevenue?: { endpoint: string; payer: string; revenueUsdcUnits: number; costUsdcUnits: number } })._pendingRevenue = {
      endpoint: 'video',
      payer,
      revenueUsdcUnits: config.x402VideoPriceUsdcUnits,
      costUsdcUnits: config.computeCostUsdcUnitsPerRequest,
    };
    return {
      artifact: { mime: result.mime, bytes: result.bytes, data: result.buffer.toString('base64') },
      payment: {
        payer,
        priceUsdcUnits: config.x402VideoPriceUsdcUnits,
        costUsdcUnits: config.computeCostUsdcUnitsPerRequest,
      },
    };
  });
}
