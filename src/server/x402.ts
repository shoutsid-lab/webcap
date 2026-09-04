import type { FastifyInstance, FastifyRequest } from 'fastify';
import { paymentMiddleware } from '@x402/fastify';
import { x402ResourceServer, type FacilitatorClient, type HTTPRequestContext, type RoutesConfig } from '@x402/core/server';
import type { PaymentRequired, PaymentRequirements } from '@x402/core/types';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import type { WebcapConfig, X402Network } from '../config.js';

export const X402_CAPTURE_PATTERN = 'POST /v1/x402/capture';
export const X402_CAPTURE_PATH = '/v1/x402/capture';

const X402_VERSION = 2;
const X402_MAX_TIMEOUT_SECONDS = 300;
const X402_DESCRIPTION = 'Capture a URL as PNG/JPEG/PDF + free OG metadata';
const X402_MIME_TYPE = 'application/json';

// EIP-712 domain of each chain's USDC deploy; a mismatch makes every
// payment signature unrecoverable (sepolia "USDC" vs mainnet "USD Coin").
const EIP712_DOMAINS: Record<X402Network, { readonly name: string; readonly version: string }> = {
  'eip155:84532': { name: 'USDC', version: '2' },
  'eip155:8453': { name: 'USD Coin', version: '2' },
};

/** The single payment requirement webcap advertises on the x402 route. */
export function buildX402Requirement(config: WebcapConfig): PaymentRequirements {
  const network = config.x402Network;
  if (network === undefined) throw new Error('x402 is disabled (WEBCAP_CHAIN=local)');
  return {
    scheme: 'exact',
    network,
    asset: config.x402Asset,
    amount: String(config.x402PriceUsdcUnits),
    payTo: config.x402PayTo,
    maxTimeoutSeconds: X402_MAX_TIMEOUT_SECONDS,
    extra: EIP712_DOMAINS[network],
  };
}

/** 402 body mirror of the PAYMENT-REQUIRED header (curl/agent-friendly). */
export function buildUnpaidBody(context: HTTPRequestContext, requirement: PaymentRequirements): PaymentRequired {
  return {
    x402Version: X402_VERSION,
    error: 'Payment required',
    resource: { url: context.adapter.getUrl(), description: X402_DESCRIPTION, mimeType: X402_MIME_TYPE },
    accepts: [requirement],
  };
}

export function buildX402Routes(config: WebcapConfig): RoutesConfig {
  const requirement = buildX402Requirement(config);
  return {
    [X402_CAPTURE_PATTERN]: {
      accepts: {
        scheme: requirement.scheme,
        network: requirement.network,
        payTo: requirement.payTo,
        price: { asset: requirement.asset, amount: requirement.amount, extra: requirement.extra },
        maxTimeoutSeconds: requirement.maxTimeoutSeconds,
      },
      description: X402_DESCRIPTION,
      mimeType: X402_MIME_TYPE,
      unpaidResponseBody: (context) => ({ contentType: X402_MIME_TYPE, body: buildUnpaidBody(context, requirement) }),
    },
  };
}

/**
 * Register the x402 payment hooks (onRequest verify / onSend settle /
 * onError cancel) ahead of the routes. No-op when x402 is disabled.
 */
export function registerX402Middleware(
  app: FastifyInstance,
  config: WebcapConfig,
  facilitator: FacilitatorClient | undefined,
): void {
  const network = config.x402Network;
  if (network === undefined) return;
  if (facilitator === undefined) {
    throw new Error('x402 is enabled but no facilitator client was provided');
  }
  const resourceServer = new x402ResourceServer(facilitator).register(network, new ExactEvmScheme());
  paymentMiddleware(app, buildX402Routes(config), resourceServer);
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
