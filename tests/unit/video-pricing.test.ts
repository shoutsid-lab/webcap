import { describe, expect, it } from 'vitest';
import { DEFAULT_X402_VIDEO_PRICE_USDC_UNITS, loadConfig } from '../../src/config.js';

const PUBLIC_URL = 'http://localhost:8080';
const SEP = { WEBCAP_CHAIN: 'base-sepolia', WEBCAP_PUBLIC_BASE_URL: PUBLIC_URL } as const;

describe('config: video pricing', () => {
  it('defaults the video price to 5000 atomic units ($0.005)', () => {
    expect(DEFAULT_X402_VIDEO_PRICE_USDC_UNITS).toBe(5_000);
    const cfg = loadConfig({ ...SEP });
    expect(cfg.x402VideoPriceUsdcUnits).toBe(DEFAULT_X402_VIDEO_PRICE_USDC_UNITS);
  });

  it('honors WEBCAP_X402_VIDEO_PRICE_USDC (human units -> atomic units)', () => {
    const cfg = loadConfig({ ...SEP, WEBCAP_X402_VIDEO_PRICE_USDC: '0.005' });
    expect(cfg.x402VideoPriceUsdcUnits).toBe(5_000);
  });

  it('prices video above capture (5000 > 1000)', () => {
    // Justification: video costs 5x capture — a sustained headless-Chromium
    // recording session (~30s) vs a single capture (~2-5s still), plus
    // video-bytes storage pressure. The ladder stays: audit/map-lite 2000 <
    // video 5000 < extract 10000.
    const cfg = loadConfig({ ...SEP });
    expect(cfg.x402VideoPriceUsdcUnits).toBe(5_000);
    expect(cfg.x402VideoPriceUsdcUnits).toBeGreaterThan(cfg.x402PriceUsdcUnits);
  });
});
