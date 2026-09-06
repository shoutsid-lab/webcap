/**
 * The USDC pricing model for webcap: the credit packs (PACKS) and the
 * credit/USDC exchange math (6-decimal USDC scale, per-credit price, capture
 * cost, and the 100-run watch top-up pack price). Split out of config.ts as a
 * pure move (no behavior change); config.ts re-exports everything it used to.
 */
import type { WebcapConfig } from '../config.js';

export type PackName = 'starter' | 'pro' | 'max';

export interface CreditPack {
  readonly credits: number;
  readonly usd: number;
  /** USDC amount in 6-decimal units. */
  readonly usdc: number;
}

export const PACKS: Record<PackName, CreditPack> = {
  starter: { credits: 100, usd: 0.5, usdc: 500_000 },
  pro: { credits: 1000, usd: 3.0, usdc: 3_000_000 },
  max: { credits: 10_000, usd: 12.0, usdc: 12_000_000 },
};

/** Look up a credit pack by name; throws on unknown names. */
export function getPack(name: string): CreditPack {
  if (name === 'starter' || name === 'pro' || name === 'max') return PACKS[name];
  throw new Error(`unknown pack: ${name}`);
}

export const CREDITS_PER_USDC = 100;
export const USDC_SCALE = 1_000_000;
export const USDC_UNITS_PER_CREDIT = USDC_SCALE / CREDITS_PER_USDC;
export const PRICE_PER_CREDIT = 1 / CREDITS_PER_USDC;
export const CAPTURE_COST_CREDITS = 1;

/** Runs per watch top-up pack: the x402 top-up route sells exactly this many runs. */
export const WATCH_TOPUP_RUNS = 100;

/**
 * Price of a 100-run watch top-up pack in 6-decimal USDC units:
 * the watch's mode unit price × 100 (capture: x402PriceUsdcUnits × 100,
 * extract: x402ExtractPriceUsdcUnits × 100).
 */
export function watchTopUpPriceUsdcUnits(mode: 'capture' | 'extract', config: WebcapConfig): number {
  const unit = mode === 'extract' ? config.x402ExtractPriceUsdcUnits : config.x402PriceUsdcUnits;
  return unit * WATCH_TOPUP_RUNS;
}

/** Credits granted for a settled USDC payment: floor(paidUsdc * CREDITS_PER_USDC). */
export function creditsForUsdc(usdcUnits: bigint): number {
  return Number(usdcUnits / BigInt(USDC_UNITS_PER_CREDIT));
}

/** 6-decimal USDC units required to buy `credits`. */
export function usdcUnitsForCredits(credits: number): number {
  return credits * USDC_UNITS_PER_CREDIT;
}

/** USDC (human units) required to buy `credits`. */
export function usdcForCredits(credits: number): number {
  return credits / CREDITS_PER_USDC;
}
