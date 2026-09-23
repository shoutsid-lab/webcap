/**
 * Shared free-trial claim gate: EIP-191 personal_sign proof, one claim per
 * wallet per endpoint, fixed-window per-IP burst budget, endpoint-bound
 * messages (a signature for one trial endpoint cannot be replayed for
 * another). The legacy capture-only message is still accepted for the
 * capture trial so signatures minted against the old docs keep working.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyMessage } from 'ethers';
import { USDC_SCALE, WATCH_TOPUP_RUNS, watchTopUpPriceUsdcUnits, type WebcapConfig } from '../config.js';
import { isTrialEndpoint, trialMessage, trialMessageFor, TRIAL_ENDPOINTS, type TrialEndpoint, type TrialsRepo } from '../db/trials.js';
import { HttpError, unprocessable } from '../util/errors.js';
import { RateLimiter, rejectRateLimited } from '../util/ratelimit.js';
import { isRecord } from './capture-parse.js';

export { TRIAL_ENDPOINTS, isTrialEndpoint, type TrialEndpoint };

/**
 * One entry in the paid catalog an agent can move to once its free capacity is
 * spent. `endpoint` keeps the "METHOD /path" shape the paidNext pointers use.
 */
export interface PaidOption {
  readonly endpoint: string;
  readonly priceUsdcUnits: number;
  readonly priceUsdc: number;
  readonly note: string;
}

/** Paid endpoint each trial is a try-before-you-buy of. */
const TRIAL_PAID_ENDPOINT: Record<TrialEndpoint, string> = {
  capture: 'POST /v1/x402/capture',
  extract: 'POST /v1/x402/extract',
  audit: 'POST /v1/x402/audit',
  'map-lite': 'POST /v1/x402/map-lite',
  analyze: 'POST /v1/x402/analyze',
};

/**
 * The complete paid catalog, priced from config. This is the single source of
 * truth for every paidNext pointer, so an agent that exhausts its free calls
 * always receives the whole menu (prices included) instead of an empty one.
 * Prices mirror the 402 challenges; `video` and `analyze/batch` are paid-only.
 */
export function paidCatalogFor(config: WebcapConfig): PaidOption[] {
  const rows: Array<[string, number, string]> = [
    ['POST /v1/x402/capture', config.x402PriceUsdcUnits, 'screenshot a URL as PNG/JPEG/PDF'],
    ['POST /v1/x402/extract', config.x402ExtractPriceUsdcUnits, 'structured content, or a batch of up to 50 URLs for one payment'],
    ['POST /v1/x402/audit', config.x402AuditPriceUsdcUnits, 'SEO + link/OG health audit'],
    ['POST /v1/x402/map-lite', config.x402AuditPriceUsdcUnits, 'site URL list'],
    ['POST /v1/x402/video', config.x402VideoPriceUsdcUnits, 'scroll-capture to MP4/WebM (no free trial)'],
    ['POST /v1/x402/analyze', config.x402ExtractPriceUsdcUnits, 'model-backed visual analysis'],
    ['POST /v1/x402/analyze/batch', config.x402ExtractPriceUsdcUnits, 'batch visual analysis of up to 10 URLs for one payment'],
  ];
  return rows.map(([endpoint, priceUsdcUnits, note]) => ({
    endpoint,
    priceUsdcUnits,
    priceUsdc: priceUsdcUnits / USDC_SCALE,
    note,
  }));
}

/**
 * How to actually pay, for an agent that has never used x402 before. Field
 * names mirror the 402 challenge (`accepts[0]`) so the two agree: rail, scheme,
 * network, asset and payTo are read from the same config the challenges use.
 */
export interface HowToPay {
  readonly rail: 'x402';
  readonly scheme: 'exact';
  readonly network: string | null;
  readonly asset: string | null;
  readonly payTo: string | null;
  readonly flow: readonly string[];
  readonly guide: string;
  readonly openapi: string;
}

export function howToPayFor(config: WebcapConfig): HowToPay {
  return {
    rail: 'x402',
    scheme: 'exact',
    // null when x402 is disabled (WEBCAP_CHAIN=local has no real USDC).
    network: config.x402Network ?? null,
    asset: config.x402Asset ?? null,
    payTo: config.x402PayTo ?? null,
    flow: [
      'POST the paid endpoint with your JSON body and no payment header',
      'read the 402 response: accepts[0] carries scheme/network/asset/amount/payTo',
      'sign a gasless EIP-3009 transferWithAuthorization from your wallet (the facilitator pays gas)',
      'retry the same POST with the PAYMENT-SIGNATURE header; the result is returned once it settles',
    ],
    guide: `${config.publicBaseUrl}/skill.md`,
    openapi: `${config.publicBaseUrl}/openapi.json`,
  };
}

/**
 * Recurring path: a watch re-captures a URL on a schedule and is topped up in
 * 100-run packs. Free to create; it pauses after a 'no-credit' run until the
 * first top-up. Pointed at from the trial menu because it is the only
 * subscription-shaped surface an agent can hold.
 */
export function recurringFor(config: WebcapConfig): {
  create: string;
  topUp: string;
  runs: number;
  priceUsdc: { capture: number; extract: number };
} {
  return {
    create: 'POST /v1/watches',
    topUp: 'POST /v1/x402/watches/topup',
    runs: WATCH_TOPUP_RUNS,
    priceUsdc: {
      capture: watchTopUpPriceUsdcUnits('capture', config) / USDC_SCALE,
      extract: watchTopUpPriceUsdcUnits('extract', config) / USDC_SCALE,
    },
  };
}

/** Paid counterpart of a trial endpoint (price source for paidNext pointers). */
export function trialPaidNextFor(
  config: WebcapConfig,
  endpoint: TrialEndpoint,
): { endpoint: string; priceUsdcUnits: number; guide: string } {
  const wanted = TRIAL_PAID_ENDPOINT[endpoint];
  const option = paidCatalogFor(config).find((o) => o.endpoint === wanted);
  if (option === undefined) throw new Error(`no paid option for trial endpoint ${endpoint}`);
  return { endpoint: option.endpoint, priceUsdcUnits: option.priceUsdcUnits, guide: howToPayFor(config).guide };
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
      howToPay: howToPayFor(config),
    });
  }
  if (trials.claimed(payer, endpoint)) {
    throw new HttpError(409, 'already_claimed', `this wallet already claimed its free trial ${endpoint}`, {
      paidNext: trialPaidNextFor(config, endpoint),
      remaining: remainingTrials(trials, payer),
      howToPay: howToPayFor(config),
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
      howToPay: howToPayFor(gate.config),
    });
  }
  return true;
}

/**
 * Machine-readable trial menu (GET /v1/x402/trial/status).
 *
 * payerLower is null when the caller passed no ?payer=: the menu is still
 * 200 with the full recipe, paid catalog and howToPay — claimed is just []
 * and the example uses a placeholder address. A wallet-less bot exploring
 * the free path must never hit a dead end for lacking an address.
 *
 * The menu is only half the answer: `paid`, `howToPay` and `recurring` are
 * present regardless of what is left, so an agent that has burned all five
 * trials is still handed the full priced catalog and the payment flow rather
 * than an empty list. A free surface that returns nothing is a dead end.
 */
export function trialStatusFor(gate: TrialGate, payerLower: string | null): {
  payer: string | null;
  claimed: TrialEndpoint[];
  available: Array<{ endpoint: TrialEndpoint; trial: string; paid: string; priceUsdc: number }>;
  allTrialsUsed: boolean;
  nextStep: string;
  paid: PaidOption[];
  howToPay: HowToPay;
  recurring: ReturnType<typeof recurringFor>;
  howToClaim: { messageTemplate: string; signature: string; example: string };
} {
  const claimed = payerLower === null ? [] : gate.trials.claimedEndpoints(payerLower);
  const claimedSet = new Set(claimed);
  const available = TRIAL_ENDPOINTS.filter((e) => !claimedSet.has(e)).map((endpoint) => ({
    endpoint,
    trial: `POST /v1/x402/trial${endpoint === 'capture' ? '' : `/${endpoint}`}`,
    paid: trialPaidNextFor(gate.config, endpoint).endpoint,
    priceUsdc: trialPriceUsdc(gate.config, endpoint),
  }));
  const catalog = paidCatalogFor(gate.config);
  // The catalog is a fixed table, so this is an invariant guard, not a case.
  const cheapest = catalog[0];
  if (cheapest === undefined) throw new Error('paid catalog is empty');
  const nextStep =
    available.length > 0
      ? `${available.length} free trial${available.length === 1 ? '' : 's'} left (${available
          .map((a) => a.endpoint)
          .join(', ')}). After those, every call is paid: see "paid" for prices and "howToPay" for the x402 flow.`
      : `All free trials used. Every further call is paid — e.g. ${cheapest.endpoint} at $${cheapest.priceUsdc}; see "paid" for the full catalog and "howToPay" for the x402 flow.`;
  return {
    payer: payerLower,
    claimed,
    available,
    allTrialsUsed: available.length === 0,
    nextStep:
      payerLower === null
        ? `${nextStep} Pass ?payer=<your lowercase 0x address> to see that wallet's claimed/available state.`
        : nextStep,
    paid: catalog,
    howToPay: howToPayFor(gate.config),
    recurring: recurringFor(gate.config),
    howToClaim: {
      messageTemplate: 'Claim one free webcap trial {endpoint} for {payer}',
      signature: 'EIP-191 personal_sign of the exact message with your lowercase 0x address as {payer}',
      example: trialMessageFor('capture', payerLower ?? '<lowercase-0x>'),
    },
  };
}
