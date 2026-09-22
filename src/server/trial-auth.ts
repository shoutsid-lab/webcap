/**
 * Shared free-trial claim gate: EIP-191 personal_sign proof, one claim per
 * wallet per endpoint, fixed-window per-IP burst budget, endpoint-bound
 * messages (a signature for one trial endpoint cannot be replayed for
 * another). The legacy capture-only message is still accepted for the
 * capture trial so signatures minted against the old docs keep working.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyMessage } from 'ethers';
import { USDC_SCALE, type WebcapConfig } from '../config.js';
import { isTrialEndpoint, trialMessage, trialMessageFor, TRIAL_ENDPOINTS, type TrialEndpoint, type TrialsRepo } from '../db/trials.js';
import { HttpError, unprocessable } from '../util/errors.js';
import { RateLimiter, rejectRateLimited } from '../util/ratelimit.js';
import { isRecord } from './capture-parse.js';

export { TRIAL_ENDPOINTS, isTrialEndpoint, type TrialEndpoint };

/** Paid counterpart of each trial endpoint (price source for paidNext pointers). */
export function trialPaidNextFor(
  config: WebcapConfig,
  endpoint: TrialEndpoint,
): { endpoint: string; priceUsdcUnits: number; guide: string } {
  const guide = `${config.publicBaseUrl}/skill.md`;
  switch (endpoint) {
    case 'capture':
      return { endpoint: 'POST /v1/x402/capture', priceUsdcUnits: config.x402PriceUsdcUnits, guide };
    case 'extract':
      return { endpoint: 'POST /v1/x402/extract', priceUsdcUnits: config.x402ExtractPriceUsdcUnits, guide };
    case 'audit':
      return { endpoint: 'POST /v1/x402/audit', priceUsdcUnits: config.x402AuditPriceUsdcUnits, guide };
    case 'map-lite':
      return { endpoint: 'POST /v1/x402/map-lite', priceUsdcUnits: config.x402AuditPriceUsdcUnits, guide };
    case 'analyze':
      return { endpoint: 'POST /v1/x402/analyze', priceUsdcUnits: config.x402ExtractPriceUsdcUnits, guide };
  }
}

export function trialPriceUsdc(config: WebcapConfig, endpoint: TrialEndpoint): number {
  return trialPaidNextFor(config, endpoint).priceUsdcUnits / USDC_SCALE;
}

/** Endpoints this wallet has NOT yet claimed (drives `remaining` + status `available`). */
export function remainingTrials(trials: TrialsRepo, payerLower: string): TrialEndpoint[] {
  const claimed = new Set(trials.claimedEndpoints(payerLower));
  return TRIAL_ENDPOINTS.filter((e) => !claimed.has(e));
}

export interface TrialGate {
  readonly trials: TrialsRepo;
  readonly limiter: RateLimiter;
  readonly config: WebcapConfig;
}

/**
 * Validate a trial claim body ({payer, signature}) for `endpoint`.
 * Returns the lowercase payer. Throws 422 (bad shape), 429 (burst budget),
 * 409 (already claimed, with paidNext + remaining), or 401 (bad signature).
 */
export function checkTrialClaim(req: FastifyRequest, reply: FastifyReply, gate: TrialGate, endpoint: TrialEndpoint): string {
  const body = isRecord(req.body) ? req.body : undefined;
  const rawPayer = body?.payer;
  if (typeof rawPayer !== 'string') throw unprocessable('payer is required');
  const signature = body?.signature;
  if (typeof signature !== 'string') throw unprocessable('signature is required');
  if (!/^0x[0-9a-fA-F]{40}$/.test(rawPayer)) throw unprocessable('payer must be a 0x EVM address');
  const payer = rawPayer.toLowerCase();
  const { trials, limiter, config } = gate;
  if (!limiter.allow(req.ip)) {
    rejectRateLimited(reply, limiter, req.ip, 'trial rate limit exceeded; use the paid endpoint', {
      paidNext: trialPaidNextFor(config, endpoint),
    });
  }
  if (trials.claimed(payer, endpoint)) {
    throw new HttpError(409, 'already_claimed', `this wallet already claimed its free trial ${endpoint}`, {
      paidNext: trialPaidNextFor(config, endpoint),
      remaining: remainingTrials(trials, payer),
    });
  }
  const candidates =
    endpoint === 'capture'
      ? [trialMessageFor(endpoint, payer), trialMessage(payer)]
      : [trialMessageFor(endpoint, payer)];
  let ok = false;
  for (const message of candidates) {
    let recovered: string;
    try {
      recovered = verifyMessage(message, signature);
    } catch {
      continue;
    }
    if (recovered.toLowerCase() === payer) {
      ok = true;
      break;
    }
  }
  if (!ok) {
    throw new HttpError(401, 'unauthorized', 'trial signature does not recover to payer');
  }
  return payer;
}

/**
 * Reserve the claim AFTER auth but BEFORE running browser compute; returns
 * true when the reservation won the race. A second 409 guards the
 * check-then-act gap between checkTrialClaim and this call.
 */
export function reserveTrialClaim(gate: TrialGate, payer: string, endpoint: TrialEndpoint): boolean {
  if (!gate.trials.tryClaim(payer, endpoint)) {
    throw new HttpError(409, 'already_claimed', `this wallet already claimed its free trial ${endpoint}`, {
      paidNext: trialPaidNextFor(gate.config, endpoint),
      remaining: remainingTrials(gate.trials, payer),
    });
  }
  return true;
}

/** Machine-readable trial menu for one wallet (GET /v1/x402/trial/status). */
export function trialStatusFor(gate: TrialGate, payerLower: string): {
  payer: string;
  claimed: TrialEndpoint[];
  available: Array<{ endpoint: TrialEndpoint; trial: string; paid: string; priceUsdc: number }>;
  howToClaim: { messageTemplate: string; signature: string; example: string };
} {
  const claimed = gate.trials.claimedEndpoints(payerLower);
  const claimedSet = new Set(claimed);
  return {
    payer: payerLower,
    claimed,
    available: TRIAL_ENDPOINTS.filter((e) => !claimedSet.has(e)).map((endpoint) => ({
      endpoint,
      trial: `POST /v1/x402/trial${endpoint === 'capture' ? '' : `/${endpoint}`}`,
      paid: trialPaidNextFor(gate.config, endpoint).endpoint,
      priceUsdc: trialPriceUsdc(gate.config, endpoint),
    })),
    howToClaim: {
      messageTemplate: 'Claim one free webcap trial {endpoint} for {payer}',
      signature: 'EIP-191 personal_sign of the exact message with your lowercase 0x address as {payer}',
      example: trialMessageFor('capture', payerLower),
    },
  };
}
