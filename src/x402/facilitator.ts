import { HTTPFacilitatorClient } from '@x402/core/server';
import type { WebcapConfig } from '../config.js';
import { buildCdpCreateAuthHeaders } from './cdp-auth.js';

/** The only host CDP's per-path Ed25519 JWTs are bound to. */
const CDP_FACILITATOR_HOST = 'api.cdp.coinbase.com';

/**
 * Build the x402 facilitator client for a deployment.
 *
 * - `undefined` when x402 is disabled (no CAIP-2 network on the chain).
 * - Plain client (no auth) when no CDP keys are configured — byte-identical
 *   construction to before CDP auth existed: `{ url, timeoutMs: 30_000 }`.
 * - CDP keys present: `createAuthHeaders` mints a fresh Ed25519 JWT per path;
 *   they only work against the CDP host, so any other facilitator URL is a
 *   config error (fail fast at startup, not mid-settlement).
 */
export function buildX402Facilitator(config: WebcapConfig): HTTPFacilitatorClient | undefined {
  if (config.x402Network === undefined) return undefined;
  if (config.cdpApiKey !== undefined) {
    const host = new URL(config.x402FacilitatorUrl).hostname;
    if (host !== CDP_FACILITATOR_HOST) {
      throw new Error(
        `CDP_API_KEY_ID/CDP_API_KEY_SECRET are set but X402_FACILITATOR_URL points at '${host}'; ` +
          `CDP facilitator auth (Ed25519 JWT) only works against https://${CDP_FACILITATOR_HOST}/... ` +
          `(e.g. https://${CDP_FACILITATOR_HOST}/platform/v2/x402)`,
      );
    }
  }
  return new HTTPFacilitatorClient({
    url: config.x402FacilitatorUrl,
    timeoutMs: 30_000,
    ...(config.cdpApiKey !== undefined
      ? { createAuthHeaders: buildCdpCreateAuthHeaders(config.cdpApiKey, config.x402FacilitatorUrl) }
      : {}),
  });
}
