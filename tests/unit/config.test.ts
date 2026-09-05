import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMPUTE_COST_USDC_UNITS_PER_REQUEST,
  DEFAULT_X402_EXTRACT_PRICE_USDC_UNITS,
  DEFAULT_X402_FACILITATOR_URL,
  DEFAULT_X402_PRICE_USDC_UNITS,
  loadConfig,
  PACKS,
  getPack,
} from '../../src/config.js';

const LOCAL_CONTRACT = `0x${'11'.repeat(20)}`;
const MERCHANT_ADDR = `0x${'44'.repeat(20)}`;
const ANVIL_KEY_0 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ANVIL_ADDR_0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const PUBLIC_URL = 'http://localhost:8080';
const localEnv: NodeJS.ProcessEnv = {
  WEBCAP_CHAIN: 'local',
  LOCAL_USDC_CONTRACT: LOCAL_CONTRACT,
  WEBCAP_PUBLIC_BASE_URL: PUBLIC_URL,
};

describe('config: chain map', () => {
  it('base-sepolia resolves with the sepolia RPC, chainId 84532 and sepolia USDC', () => {
    const cfg = loadConfig({ WEBCAP_CHAIN: 'base-sepolia', WEBCAP_PUBLIC_BASE_URL: PUBLIC_URL });
    expect(cfg.chain.rpcUrl).toBe('https://sepolia.base.org');
    expect(cfg.chain.chainId).toBe(84532);
    expect(cfg.chain.usdcContract).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
    expect(cfg.chain.explorer).toBe('https://sepolia.basescan.org');
  });

  it('base resolves with the mainnet RPC, chainId 8453 and mainnet USDC', () => {
    const cfg = loadConfig({ WEBCAP_CHAIN: 'base', WEBCAP_PUBLIC_BASE_URL: PUBLIC_URL });
    expect(cfg.chain.rpcUrl).toBe('https://mainnet.base.org');
    expect(cfg.chain.chainId).toBe(8453);
    expect(cfg.chain.usdcContract).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(cfg.chain.explorer).toBe('https://basescan.org');
  });

  it('local resolves with 127.0.0.1:8545, chainId 31337 and the env USDC contract', () => {
    const cfg = loadConfig(localEnv);
    expect(cfg.chain.rpcUrl).toBe('http://127.0.0.1:8545');
    expect(cfg.chain.chainId).toBe(31337);
    expect(cfg.chain.usdcContract).toBe(LOCAL_CONTRACT);
    expect(cfg.chain.explorer).toBe('');
  });

  it('unknown chain throws', () => {
    expect(() => loadConfig({ WEBCAP_CHAIN: 'ethereum' })).toThrow(/unknown WEBCAP_CHAIN/);
  });

  it('local without LOCAL_USDC_CONTRACT throws', () => {
    expect(() => loadConfig({ WEBCAP_CHAIN: 'local' })).toThrow(/LOCAL_USDC_CONTRACT/);
  });

  it('applies env overrides and defaults for port, poll interval and db path', () => {
    const cfg = loadConfig({ ...localEnv, WEBCAP_PORT: '9999', POLL_INTERVAL_MS: '250', WEBCAP_DB: '/tmp/x.db' });
    expect(cfg.port).toBe(9999);
    expect(cfg.pollIntervalMs).toBe(250);
    expect(cfg.dbPath).toBe('/tmp/x.db');
    const defaults = loadConfig(localEnv);
    expect(defaults.port).toBe(8080);
    expect(defaults.pollIntervalMs).toBe(30_000);
    expect(defaults.dbPath).toBe('data/webcap.db');
  });
});

describe('config: public base url (artifact links)', () => {
  it('throws when WEBCAP_PUBLIC_BASE_URL is missing', () => {
    expect(() => loadConfig({ WEBCAP_CHAIN: 'base-sepolia' })).toThrow(/WEBCAP_PUBLIC_BASE_URL/);
  });

  it('parses WEBCAP_PUBLIC_BASE_URL into publicBaseUrl', () => {
    const cfg = loadConfig({ WEBCAP_CHAIN: 'base-sepolia', WEBCAP_PUBLIC_BASE_URL: 'https://cap.example.dev' });
    expect(cfg.publicBaseUrl).toBe('https://cap.example.dev');
  });
});

describe('config: server run fields (chainId/rpcUrl/usdcAddress/merchantAddress)', () => {
  it('base-sepolia exposes chainId, rpcUrl and usdcAddress at top level', () => {
    const cfg = loadConfig({ WEBCAP_CHAIN: 'base-sepolia', WEBCAP_PUBLIC_BASE_URL: PUBLIC_URL });
    expect(cfg.chainId).toBe(84532);
    expect(cfg.rpcUrl).toBe('https://sepolia.base.org');
    expect(cfg.usdcAddress).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
    expect(cfg.merchantAddress).toBe('');
  });

  it('base exposes mainnet chainId, rpcUrl and usdcAddress at top level', () => {
    const cfg = loadConfig({ WEBCAP_CHAIN: 'base', WEBCAP_PUBLIC_BASE_URL: PUBLIC_URL });
    expect(cfg.chainId).toBe(8453);
    expect(cfg.rpcUrl).toBe('https://mainnet.base.org');
    expect(cfg.usdcAddress).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  });

  it('local resolves WEBCAP_RPC_URL, WEBCAP_USDC_ADDRESS and WEBCAP_MERCHANT_ADDRESS', () => {
    const cfg = loadConfig({
      WEBCAP_CHAIN: 'local',
      WEBCAP_RPC_URL: 'http://10.1.1.1:8545',
      WEBCAP_USDC_ADDRESS: LOCAL_CONTRACT,
      WEBCAP_MERCHANT_ADDRESS: MERCHANT_ADDR,
      WEBCAP_PUBLIC_BASE_URL: PUBLIC_URL,
    });
    expect(cfg.chainId).toBe(31337);
    expect(cfg.rpcUrl).toBe('http://10.1.1.1:8545');
    expect(cfg.usdcAddress).toBe(LOCAL_CONTRACT);
    expect(cfg.chain.usdcContract).toBe(LOCAL_CONTRACT);
    expect(cfg.merchantAddress).toBe(MERCHANT_ADDR);
  });

  it('local keeps the 127.0.0.1:8545 default rpcUrl when WEBCAP_RPC_URL is unset', () => {
    const cfg = loadConfig({ ...localEnv, WEBCAP_MERCHANT_ADDRESS: MERCHANT_ADDR });
    expect(cfg.rpcUrl).toBe('http://127.0.0.1:8545');
    expect(cfg.merchantAddress).toBe(MERCHANT_ADDR);
  });

  it('merchantAddress is derived from USDC_MERCHANT_PRIVATE_KEY when provided', () => {
    const cfg = loadConfig({ ...localEnv, USDC_MERCHANT_PRIVATE_KEY: ANVIL_KEY_0, WEBCAP_MERCHANT_ADDRESS: MERCHANT_ADDR });
    expect(cfg.merchantAddress).toBe(ANVIL_ADDR_0);
    expect(cfg.merchantPrivateKey).toBe(ANVIL_KEY_0);
  });
});

describe('config: credit packs', () => {
  it('packs carry the exact credit/usd/usdc numbers', () => {
    expect(PACKS.starter).toEqual({ credits: 100, usd: 0.5, usdc: 500_000 });
    expect(PACKS.pro).toEqual({ credits: 1000, usd: 3.0, usdc: 3_000_000 });
    expect(PACKS.max).toEqual({ credits: 10_000, usd: 12.0, usdc: 12_000_000 });
  });

  it('getPack resolves known packs and unknown pack throws', () => {
    expect(getPack('starter').credits).toBe(100);
    expect(getPack('pro').usdc).toBe(3_000_000);
    expect(getPack('max').credits).toBe(10_000);
    expect(() => getPack('gold')).toThrow(/unknown pack/);
  });
});

describe('config: x402', () => {
  it('base-sepolia enables x402 on eip155:84532 with sepolia USDC and merchant payTo', () => {
    const cfg = loadConfig({ WEBCAP_CHAIN: 'base-sepolia', USDC_MERCHANT_PRIVATE_KEY: ANVIL_KEY_0, WEBCAP_PUBLIC_BASE_URL: PUBLIC_URL });
    expect(cfg.x402Network).toBe('eip155:84532');
    expect(cfg.x402Asset).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
    expect(cfg.x402PayTo).toBe(ANVIL_ADDR_0);
    expect(cfg.x402PriceUsdcUnits).toBe(DEFAULT_X402_PRICE_USDC_UNITS);
    expect(cfg.x402FacilitatorUrl).toBe(DEFAULT_X402_FACILITATOR_URL);
  });

  it('base enables x402 on eip155:8453 with mainnet USDC', () => {
    const cfg = loadConfig({ WEBCAP_CHAIN: 'base', USDC_MERCHANT_PRIVATE_KEY: ANVIL_KEY_0, WEBCAP_PUBLIC_BASE_URL: PUBLIC_URL });
    expect(cfg.x402Network).toBe('eip155:8453');
    expect(cfg.x402Asset).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  });

  it('local disables x402 (x402Network undefined) but keeps the other fields defaulted', () => {
    const cfg = loadConfig({ ...localEnv, WEBCAP_MERCHANT_ADDRESS: MERCHANT_ADDR });
    expect(cfg.x402Network).toBeUndefined();
    expect(cfg.x402Asset).toBe(LOCAL_CONTRACT);
    expect(cfg.x402PayTo).toBe(MERCHANT_ADDR);
    expect(cfg.x402PriceUsdcUnits).toBe(1_000);
  });

  it('converts WEBCAP_X402_PRICE_USDC human units to atomic units (0.002 -> 2000)', () => {
    const cfg = loadConfig({ WEBCAP_CHAIN: 'base-sepolia', WEBCAP_X402_PRICE_USDC: '0.002', WEBCAP_PUBLIC_BASE_URL: PUBLIC_URL });
    expect(cfg.x402PriceUsdcUnits).toBe(2_000);
  });

  it('rejects zero, negative, or non-numeric x402 prices', () => {
    for (const bad of ['0', '-1', 'abc', '1.2.3']) {
      expect(() => loadConfig({ WEBCAP_CHAIN: 'base-sepolia', WEBCAP_X402_PRICE_USDC: bad })).toThrow(
        /WEBCAP_X402_PRICE_USDC/,
      );
    }
  });

  it('honors X402_FACILITATOR_URL, WEBCAP_X402_ASSET and WEBCAP_X402_PAY_TO overrides', () => {
    const cfg = loadConfig({
      WEBCAP_CHAIN: 'base-sepolia',
      X402_FACILITATOR_URL: 'https://facilitator.example.com/x402',
      WEBCAP_X402_ASSET: MERCHANT_ADDR,
      WEBCAP_X402_PAY_TO: ANVIL_ADDR_0,
      WEBCAP_PUBLIC_BASE_URL: PUBLIC_URL,
    });
    expect(cfg.x402FacilitatorUrl).toBe('https://facilitator.example.com/x402');
    expect(cfg.x402Asset).toBe(MERCHANT_ADDR);
    expect(cfg.x402PayTo).toBe(ANVIL_ADDR_0);
  });

  it('rejects invalid x402 override addresses', () => {
    expect(() => loadConfig({ WEBCAP_CHAIN: 'base', WEBCAP_X402_ASSET: '0x123' })).toThrow(/WEBCAP_X402_ASSET/);
    expect(() => loadConfig({ WEBCAP_CHAIN: 'base', WEBCAP_X402_PAY_TO: 'not-an-address' })).toThrow(/WEBCAP_X402_PAY_TO/);
  });
});

describe('config: extract pricing + compute cost + model', () => {
  it('defaults the extract price above capture and the compute cost below both', () => {
    const cfg = loadConfig({ WEBCAP_CHAIN: 'base-sepolia', WEBCAP_PUBLIC_BASE_URL: PUBLIC_URL });
    expect(cfg.x402ExtractPriceUsdcUnits).toBe(DEFAULT_X402_EXTRACT_PRICE_USDC_UNITS);
    expect(cfg.computeCostUsdcUnitsPerRequest).toBe(DEFAULT_COMPUTE_COST_USDC_UNITS_PER_REQUEST);
    expect(cfg.x402ExtractPriceUsdcUnits).toBeGreaterThan(cfg.x402PriceUsdcUnits);
    expect(cfg.x402PriceUsdcUnits).toBeGreaterThan(cfg.computeCostUsdcUnitsPerRequest);
  });

  it('converts WEBCAP_X402_EXTRACT_PRICE_USDC human units to atomic units (0.01 -> 10000)', () => {
    const cfg = loadConfig({ WEBCAP_CHAIN: 'base-sepolia', WEBCAP_X402_EXTRACT_PRICE_USDC: '0.01', WEBCAP_PUBLIC_BASE_URL: PUBLIC_URL });
    expect(cfg.x402ExtractPriceUsdcUnits).toBe(10_000);
  });

  it('converts WEBCAP_COMPUTE_COST_USDC_PER_REQUEST to atomic units and allows zero', () => {
    const cfg = loadConfig({ WEBCAP_CHAIN: 'base-sepolia', WEBCAP_COMPUTE_COST_USDC_PER_REQUEST: '0.0005', WEBCAP_PUBLIC_BASE_URL: PUBLIC_URL });
    expect(cfg.computeCostUsdcUnitsPerRequest).toBe(500);
    const zero = loadConfig({ WEBCAP_CHAIN: 'base-sepolia', WEBCAP_COMPUTE_COST_USDC_PER_REQUEST: '0', WEBCAP_PUBLIC_BASE_URL: PUBLIC_URL });
    expect(zero.computeCostUsdcUnitsPerRequest).toBe(0);
  });

  it('rejects a negative compute cost', () => {
    expect(() => loadConfig({ WEBCAP_CHAIN: 'base-sepolia', WEBCAP_COMPUTE_COST_USDC_PER_REQUEST: '-1' })).toThrow(
      /WEBCAP_COMPUTE_COST_USDC_PER_REQUEST/,
    );
  });

  it('defaults model config to empty (deterministic only) and honors overrides', () => {
    const cfg = loadConfig({ WEBCAP_CHAIN: 'base-sepolia', WEBCAP_PUBLIC_BASE_URL: PUBLIC_URL });
    expect(cfg.modelApiBaseUrl).toBe('');
    expect(cfg.modelApiKey).toBe('');
    expect(cfg.modelName).toBe('');
    const overridden = loadConfig({
      WEBCAP_CHAIN: 'base-sepolia',
      MODEL_API_BASE_URL: 'https://api.example.com/v1',
      MODEL_API_KEY: 'sk-test',
      MODEL_NAME: 'gpt-4o-mini',
      WEBCAP_PUBLIC_BASE_URL: PUBLIC_URL,
    });
    expect(overridden.modelApiBaseUrl).toBe('https://api.example.com/v1');
    expect(overridden.modelApiKey).toBe('sk-test');
    expect(overridden.modelName).toBe('gpt-4o-mini');
  });
});
