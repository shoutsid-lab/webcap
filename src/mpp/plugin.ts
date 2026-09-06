/**
 * The MPP 402-challenge hook: attaches the `Payment` WWW-Authenticate header
 * to unpaid x402 402s (dual-protocol challenge) without touching body bytes.
 *
 * Fires ONLY when the reply is a 402 AND the request is one of the 6 paid
 * patterns (GET/POST x capture/extract/topup). MPP disabled (no
 * MPP_SECRET_KEY -> loadMppConfig returns enabled:false) = no hook
 * registered, zero header change.
 *
 * Price resolution mirrors the x402 layer identically: static units for
 * capture/extract from config, dynamic top-up from `?watchId=` with the
 * capture-pack fallback (cf. topUpPriceUsdcUnitsForContext in
 * src/server/x402/routes.ts — reimplemented here from the query string
 * because that function is private; the request body is NEVER read).
 *
 * Hook-chain seam for settle (Task 4): reuse `resolveMppAmountUsdcUnits`
 * (same price the challenge binds) and `isMppPaidPattern` (same gate) so
 * credential verification prices identically to the challenge.
 */
import type { FastifyInstance } from 'fastify';
import { DEFAULT_X402_MAX_TIMEOUT_MS, watchTopUpPriceUsdcUnits, type WebcapConfig } from '../config.js';
import type { Db } from '../db/index.js';
import { makeWatchRepo, type WatchRepo } from '../watch/store.js';
import { X402_CAPTURE_PATH, X402_EXTRACT_PATH, X402_TOPUP_PATH } from '../server/x402/routes.js';
import { buildWwwAuthenticate } from './challenge.js';
import { loadMppConfig } from './config.js';

const PAID_PATHS: ReadonlySet<string> = new Set([X402_CAPTURE_PATH, X402_EXTRACT_PATH, X402_TOPUP_PATH]);

/** True when method+path is one of the 6 paid patterns (GET/POST x capture/extract/topup). */
export function isMppPaidPattern(method: string, url: string): boolean {
  if (method !== 'GET' && method !== 'POST') return false;
  const path = url.split('?')[0];
  return PAID_PATHS.has(path ?? '');
}

/** First `watchId` query value, mirroring the x402 top-up context resolution. */
function watchIdOf(url: string): string | undefined {
  const query = url.split('?')[1];
  if (query === undefined) return undefined;
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    const key = eq < 0 ? part : part.slice(0, eq);
    if (key !== 'watchId') continue;
    const raw = eq < 0 ? '' : decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '));
    if (raw !== '') return raw;
  }
  return undefined;
}

export interface MppPriceInput {
  readonly method: string;
  readonly url: string;
  readonly config: WebcapConfig;
  readonly watchRepo: WatchRepo;
}

/**
 * Atomic USDC units bound into the MPP challenge: static units for
 * capture/extract, dynamic top-up from `?watchId=` (unknown/absent watch ->
 * capture-pack fallback). Never reads the request body.
 */
export function resolveMppAmountUsdcUnits(input: MppPriceInput): number {
  const path = input.url.split('?')[0];
  if (path === X402_CAPTURE_PATH) return input.config.x402PriceUsdcUnits;
  if (path === X402_EXTRACT_PATH) return input.config.x402ExtractPriceUsdcUnits;
  if (path === X402_TOPUP_PATH) {
    const watchId = watchIdOf(input.url);
    const watch = watchId !== undefined ? input.watchRepo.get(watchId) : null;
    return watch !== null
      ? watchTopUpPriceUsdcUnits(watch.mode, input.config)
      : watchTopUpPriceUsdcUnits('capture', input.config);
  }
  throw new Error(`not an MPP paid path: ${path ?? input.url}`);
}

/**
 * Register the MPP challenge `onSend` hook AFTER the x402 middleware (call
 * site: src/server/server.ts, next to registerX402Middleware). Payload bytes
 * pass through untouched; only the WWW-Authenticate header is set.
 */
export function registerMppChallengeHook(app: FastifyInstance, config: WebcapConfig, db: Db): void {
  const mpp = loadMppConfig(process.env, config.publicBaseUrl);
  if (!mpp.enabled) return;
  const watchRepo = makeWatchRepo(db);
  const maxTimeoutSeconds = Math.round((config.x402MaxTimeoutMs ?? DEFAULT_X402_MAX_TIMEOUT_MS) / 1000);
  app.addHook('onSend', async (request, reply, payload) => {
    if (reply.statusCode !== 402) return payload;
    if (!isMppPaidPattern(request.method, request.url)) return payload;
    const header = buildWwwAuthenticate({
      amountUsdcUnits: resolveMppAmountUsdcUnits({ method: request.method, url: request.url, config, watchRepo }),
      recipient: config.x402PayTo,
      realm: mpp.realm,
      method: 'evm',
      intent: 'charge',
      secret: mpp.secret,
      expiresAtSec: Math.floor(Date.now() / 1000) + maxTimeoutSeconds,
      chainId: mpp.chainId,
    });
    reply.header('WWW-Authenticate', header);
    return payload;
  });
}
