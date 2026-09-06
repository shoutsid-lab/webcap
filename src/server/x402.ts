/**
 * The x402 payment entry for webcap: installs the x402 payment middleware
 * (onRequest verify / onSend settle / onError cancel) ahead of the routes and
 * exposes the payer address of a settled request (x402Payer). The 402-challenge
 * builders live in ./x402/challenges.ts and the route-table assembly in
 * ./x402/routes.ts; everything this module used to export is re-exported here,
 * so no import site changes.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { paymentMiddleware } from '@x402/fastify';
import { x402ResourceServer, type FacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import type { WebcapConfig } from '../config.js';
import type { Db } from '../db/index.js';
import { makeWatchRepo } from '../watch/store.js';
import { registerMppSettleHook } from '../mpp/plugin.js';
import { buildAllX402Routes } from './x402/routes.js';

export { BAZAAR_EXAMPLE_PAYER, buildUnpaidBody, topUpOutputExample, type UnpaidBazaarMetadata } from './x402/challenges.js';
export { X402_CAPTURE_PATH, X402_CAPTURE_PATTERN, X402_EXTRACT_PATH, X402_EXTRACT_PATTERN, X402_JOBS_PATH, X402_JOBS_PATTERN, X402_MAP_LITE_PATH, X402_MAP_LITE_PATTERN, X402_TOPUP_PATH, X402_TOPUP_PATTERN, X402_VIDEO_PATH, X402_VIDEO_PATTERN } from './x402/routes.js';
export { buildAllX402Routes, buildX402Requirement, buildX402Routes, buildX402TopUpRoute } from './x402/routes.js';

/**
 * Register the x402 payment hooks (onRequest verify / onSend settle /
 * onError cancel) ahead of the routes. No-op when x402 is disabled.
 * `db` supplies the watch store for the top-up route's per-request price.
 */
export function registerX402Middleware(
  app: FastifyInstance,
  config: WebcapConfig,
  facilitator: FacilitatorClient | undefined,
  db: Db,
): void {
  const network = config.x402Network;
  if (network === undefined) return;
  if (facilitator === undefined) {
    throw new Error('x402 is enabled but no facilitator client was provided');
  }
  const resourceServer = new x402ResourceServer(facilitator).register(network, new ExactEvmScheme());
  // MPP settle hooks register BEFORE paymentMiddleware so they run first:
  // the settle onRequest verifies ahead of x402's verify, the settle onSend
  // consumes the settled marker ahead of x402's settle (single settlement).
  // Disabled MPP registers zero hooks. The SAME resourceServer is shared.
  registerMppSettleHook(app, config, db, resourceServer);
  paymentMiddleware(app, buildAllX402Routes(config, makeWatchRepo(db)), resourceServer);
}

/** Payer EOA address from the verified payment context, if any. */
export function x402Payer(req: FastifyRequest): string | undefined {
  const payload = req.x402Context?.paymentPayload?.payload;
  if (payload === undefined) return undefined;
  const auth = payload['authorization'];
  if (typeof auth !== 'object' || auth === null) return undefined;
  const from = (auth as { from?: unknown }).from;
  return typeof from === 'string' ? from : undefined;
}
