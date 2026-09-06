import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_SWEEP_INTERVAL_MS,
  DEFAULT_ARTIFACT_RETENTION_DAYS,
  DEFAULT_BAZAAR_CATALOG_URL,
  DEFAULT_BODY_LIMIT_BYTES,
  DEFAULT_CAPTURE_TIMEOUT_CAP_MS,
  DEFAULT_CAPTURE_TIMEOUT_MS,
  DEFAULT_CREDITS,
  DEFAULT_COMPUTE_COST_USDC_UNITS_PER_REQUEST,
  DEFAULT_INVOICE_TTL_MS,
  DEFAULT_MODEL_TIMEOUT_MS,
  DEFAULT_PREVIEW_HEADINGS_LIMIT,
  DEFAULT_PREVIEW_LINKS_LIMIT,
  DEFAULT_PREVIEW_MARKDOWN_LIMIT,
  DEFAULT_PREVIEW_RATE_LIMIT,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_WEBHOOK_RETRIES,
  DEFAULT_WEBHOOK_TIMEOUT_MS,
  DEFAULT_X402_EXTRACT_PRICE_USDC_UNITS,
  DEFAULT_X402_FACILITATOR_URL,
  DEFAULT_X402_MAX_TIMEOUT_MS,
  DEFAULT_X402_PRICE_USDC_UNITS,
  EIP712_DOMAINS,
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

describe('config: preview rate limit', () => {
  it('defaults previewRateLimit to DEFAULT_PREVIEW_RATE_LIMIT (10)', () => {
    const cfg = loadConfig({ WEBCAP_CHAIN: 'base-sepolia', WEBCAP_PUBLIC_BASE_URL: PUBLIC_URL });
    expect(cfg.previewRateLimit).toBe(DEFAULT_PREVIEW_RATE_LIMIT);
    expect(DEFAULT_PREVIEW_RATE_LIMIT).toBe(10);
  });

  it('honors a WEBCAP_PREVIEW_RATE_LIMIT override', () => {
    const cfg = loadConfig({ WEBCAP_CHAIN: 'base-sepolia', WEBCAP_PREVIEW_RATE_LIMIT: '25', WEBCAP_PUBLIC_BASE_URL: PUBLIC_URL });
    expect(cfg.previewRateLimit).toBe(25);
  });

  it('rejects a non-positive or non-numeric WEBCAP_PREVIEW_RATE_LIMIT', () => {
    for (const bad of ['0', '-5', 'abc']) {
      expect(() => loadConfig({ WEBCAP_CHAIN: 'base-sepolia', WEBCAP_PREVIEW_RATE_LIMIT: bad, WEBCAP_PUBLIC_BASE_URL: PUBLIC_URL })).toThrow(
        /invalid numeric env value/,
      );
    }
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

describe('config: CDP facilitator auth (optional Ed25519 JWT keys)', () => {
  it('cdpApiKey is undefined when neither CDP var is set', () => {
    const cfg = loadConfig({ WEBCAP_CHAIN: 'base-sepolia', WEBCAP_PUBLIC_BASE_URL: PUBLIC_URL });
    expect(cfg.cdpApiKey).toBeUndefined();
  });

  it('cdpApiKey is undefined when both CDP vars are set but empty', () => {
    const cfg = loadConfig({
      WEBCAP_CHAIN: 'base-sepolia',
      WEBCAP_PUBLIC_BASE_URL: PUBLIC_URL,
      CDP_API_KEY_ID: '',
      CDP_API_KEY_SECRET: '   ',
    });
    expect(cfg.cdpApiKey).toBeUndefined();
  });

  it('cdpApiKey is { id, secret } when both CDP vars are set', () => {
    const cfg = loadConfig({
      WEBCAP_CHAIN: 'base-sepolia',
      WEBCAP_PUBLIC_BASE_URL: PUBLIC_URL,
      CDP_API_KEY_ID: 'key-id-123',
      CDP_API_KEY_SECRET: 'ZGVmYWx0LXNlY3JldA==',
    });
    expect(cfg.cdpApiKey).toEqual({ id: 'key-id-123', secret: 'ZGVmYWx0LXNlY3JldA==' });
  });

  it('throws naming both vars when exactly one CDP var is set', () => {
    for (const env of [
      { CDP_API_KEY_ID: 'key-id-only' },
      { CDP_API_KEY_SECRET: 'c2VjcmV0LW9ubHk=' },
    ]) {
      expect(() => loadConfig({ WEBCAP_CHAIN: 'base-sepolia', WEBCAP_PUBLIC_BASE_URL: PUBLIC_URL, ...env })).toThrow(
        /CDP_API_KEY_ID/,
      );
      expect(() => loadConfig({ WEBCAP_CHAIN: 'base-sepolia', WEBCAP_PUBLIC_BASE_URL: PUBLIC_URL, ...env })).toThrow(
        /CDP_API_KEY_SECRET/,
      );
    }
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

// Optional tunables: defaults equal the previous hardcoded behavior (no .env change).
const SEP = { WEBCAP_CHAIN: 'base-sepolia', WEBCAP_PUBLIC_BASE_URL: PUBLIC_URL } as const;

describe('config: centralized tunables', () => {
  it('defaults Fastify requestTimeout to 120s and bodyLimit to 2MB', () => {
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(120_000);
    expect(DEFAULT_BODY_LIMIT_BYTES).toBe(2_000_000);
    const cfg = loadConfig({ ...SEP });
    expect(cfg.requestTimeoutMs).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
    expect(cfg.bodyLimitBytes).toBe(DEFAULT_BODY_LIMIT_BYTES);
  });

  it('honors WEBCAP_REQUEST_TIMEOUT_MS and WEBCAP_BODY_LIMIT_BYTES overrides', () => {
    const cfg = loadConfig({ ...SEP, WEBCAP_REQUEST_TIMEOUT_MS: '45000', WEBCAP_BODY_LIMIT_BYTES: '1000000' });
    expect(cfg.requestTimeoutMs).toBe(45_000);
    expect(cfg.bodyLimitBytes).toBe(1_000_000);
  });

  it('rejects invalid requestTimeout/bodyLimit values', () => {
    for (const bad of ['0', '-5', 'abc']) {
      expect(() => loadConfig({ ...SEP, WEBCAP_REQUEST_TIMEOUT_MS: bad })).toThrow(/invalid numeric env value/);
      expect(() => loadConfig({ ...SEP, WEBCAP_BODY_LIMIT_BYTES: bad })).toThrow(/invalid numeric env value/);
    }
  });

  it('defaults capture timeouts: 30s page-load default, 60s client cap', () => {
    expect(DEFAULT_CAPTURE_TIMEOUT_MS).toBe(30_000);
    expect(DEFAULT_CAPTURE_TIMEOUT_CAP_MS).toBe(60_000);
    const cfg = loadConfig({ ...SEP });
    expect(cfg.captureTimeoutMs).toBe(DEFAULT_CAPTURE_TIMEOUT_MS);
    expect(cfg.captureTimeoutCapMs).toBe(DEFAULT_CAPTURE_TIMEOUT_CAP_MS);
  });

  it('honors WEBCAP_CAPTURE_TIMEOUT_MS and WEBCAP_CAPTURE_TIMEOUT_CAP_MS overrides', () => {
    const cfg = loadConfig({ ...SEP, WEBCAP_CAPTURE_TIMEOUT_MS: '40000', WEBCAP_CAPTURE_TIMEOUT_CAP_MS: '90000' });
    expect(cfg.captureTimeoutMs).toBe(40_000);
    expect(cfg.captureTimeoutCapMs).toBe(90_000);
  });

  it('rejects invalid capture timeout values', () => {
    for (const bad of ['0', '-1', 'abc']) {
      expect(() => loadConfig({ ...SEP, WEBCAP_CAPTURE_TIMEOUT_MS: bad })).toThrow(/invalid numeric env value/);
      expect(() => loadConfig({ ...SEP, WEBCAP_CAPTURE_TIMEOUT_CAP_MS: bad })).toThrow(/invalid numeric env value/);
    }
  });

  it('defaults the model timeout to 30s and honors WEBCAP_MODEL_TIMEOUT_MS', () => {
    expect(DEFAULT_MODEL_TIMEOUT_MS).toBe(30_000);
    expect(loadConfig({ ...SEP }).modelTimeoutMs).toBe(DEFAULT_MODEL_TIMEOUT_MS);
    expect(loadConfig({ ...SEP, WEBCAP_MODEL_TIMEOUT_MS: '45000' }).modelTimeoutMs).toBe(45_000);
    expect(() => loadConfig({ ...SEP, WEBCAP_MODEL_TIMEOUT_MS: '0' })).toThrow(/invalid numeric env value/);
    expect(() => loadConfig({ ...SEP, WEBCAP_MODEL_TIMEOUT_MS: 'abc' })).toThrow(/invalid numeric env value/);
  });

  it('defaults the x402 maxTimeout to 300s (in ms) and honors WEBCAP_X402_MAX_TIMEOUT_MS', () => {
    // The wire field is maxTimeoutSeconds; the env is ms so 300_000 -> 300.
    expect(DEFAULT_X402_MAX_TIMEOUT_MS).toBe(300_000);
    expect(loadConfig({ ...SEP }).x402MaxTimeoutMs).toBe(DEFAULT_X402_MAX_TIMEOUT_MS);
    expect(loadConfig({ ...SEP, WEBCAP_X402_MAX_TIMEOUT_MS: '450000' }).x402MaxTimeoutMs).toBe(450_000);
    expect(() => loadConfig({ ...SEP, WEBCAP_X402_MAX_TIMEOUT_MS: '0' })).toThrow(/invalid numeric env value/);
    expect(() => loadConfig({ ...SEP, WEBCAP_X402_MAX_TIMEOUT_MS: 'abc' })).toThrow(/invalid numeric env value/);
  });

  it('defaults watch webhook delivery to 3 attempts x 5s and honors overrides', () => {
    expect(DEFAULT_WEBHOOK_RETRIES).toBe(3);
    expect(DEFAULT_WEBHOOK_TIMEOUT_MS).toBe(5_000);
    const cfg = loadConfig({ ...SEP });
    expect(cfg.webhookRetries).toBe(DEFAULT_WEBHOOK_RETRIES);
    expect(cfg.webhookTimeoutMs).toBe(DEFAULT_WEBHOOK_TIMEOUT_MS);
    const overridden = loadConfig({ ...SEP, WEBCAP_WEBHOOK_RETRIES: '5', WEBCAP_WEBHOOK_TIMEOUT_MS: '7500' });
    expect(overridden.webhookRetries).toBe(5);
    expect(overridden.webhookTimeoutMs).toBe(7_500);
    expect(() => loadConfig({ ...SEP, WEBCAP_WEBHOOK_RETRIES: '0' })).toThrow(/invalid numeric env value/);
    expect(() => loadConfig({ ...SEP, WEBCAP_WEBHOOK_TIMEOUT_MS: '-1' })).toThrow(/invalid numeric env value/);
    expect(() => loadConfig({ ...SEP, WEBCAP_WEBHOOK_RETRIES: 'abc' })).toThrow(/invalid numeric env value/);
  });

  it('defaults the invoice TTL to 1h and honors WEBCAP_INVOICE_TTL_MS', () => {
    expect(DEFAULT_INVOICE_TTL_MS).toBe(3_600_000);
    expect(loadConfig({ ...SEP }).invoiceTtlMs).toBe(DEFAULT_INVOICE_TTL_MS);
    expect(loadConfig({ ...SEP, WEBCAP_INVOICE_TTL_MS: '1800000' }).invoiceTtlMs).toBe(1_800_000);
    expect(() => loadConfig({ ...SEP, WEBCAP_INVOICE_TTL_MS: '0' })).toThrow(/invalid numeric env value/);
    expect(() => loadConfig({ ...SEP, WEBCAP_INVOICE_TTL_MS: 'abc' })).toThrow(/invalid numeric env value/);
  });

  it('defaults invoice credits to 100 and honors WEBCAP_DEFAULT_CREDITS', () => {
    expect(DEFAULT_CREDITS).toBe(100);
    expect(loadConfig({ ...SEP }).defaultCredits).toBe(DEFAULT_CREDITS);
    expect(loadConfig({ ...SEP, WEBCAP_DEFAULT_CREDITS: '500' }).defaultCredits).toBe(500);
    expect(() => loadConfig({ ...SEP, WEBCAP_DEFAULT_CREDITS: '0' })).toThrow(/invalid numeric env value/);
    expect(() => loadConfig({ ...SEP, WEBCAP_DEFAULT_CREDITS: 'abc' })).toThrow(/invalid numeric env value/);
  });

  it('defaults the free preview slices to 5 headings / 10 links / 1500 markdown chars', () => {
    expect(DEFAULT_PREVIEW_HEADINGS_LIMIT).toBe(5);
    expect(DEFAULT_PREVIEW_LINKS_LIMIT).toBe(10);
    expect(DEFAULT_PREVIEW_MARKDOWN_LIMIT).toBe(1_500);
    const cfg = loadConfig({ ...SEP });
    expect(cfg.previewHeadingsLimit).toBe(DEFAULT_PREVIEW_HEADINGS_LIMIT);
    expect(cfg.previewLinksLimit).toBe(DEFAULT_PREVIEW_LINKS_LIMIT);
    expect(cfg.previewMarkdownLimit).toBe(DEFAULT_PREVIEW_MARKDOWN_LIMIT);
  });

  it('honors the preview slice overrides and rejects invalid values', () => {
    const cfg = loadConfig({
      ...SEP,
      WEBCAP_PREVIEW_HEADINGS_LIMIT: '7',
      WEBCAP_PREVIEW_LINKS_LIMIT: '25',
      WEBCAP_PREVIEW_MARKDOWN_LIMIT: '2000',
    });
    expect(cfg.previewHeadingsLimit).toBe(7);
    expect(cfg.previewLinksLimit).toBe(25);
    expect(cfg.previewMarkdownLimit).toBe(2_000);
    for (const bad of ['0', '-3', 'abc']) {
      expect(() => loadConfig({ ...SEP, WEBCAP_PREVIEW_HEADINGS_LIMIT: bad })).toThrow(/invalid numeric env value/);
      expect(() => loadConfig({ ...SEP, WEBCAP_PREVIEW_LINKS_LIMIT: bad })).toThrow(/invalid numeric env value/);
      expect(() => loadConfig({ ...SEP, WEBCAP_PREVIEW_MARKDOWN_LIMIT: bad })).toThrow(/invalid numeric env value/);
    }
  });

  it('defaults the bazaar catalog URL and honors WEBCAP_BAZAAR_CATALOG_URL', () => {
    expect(DEFAULT_BAZAAR_CATALOG_URL).toBe('https://cdp.coinbase.com');
    expect(loadConfig({ ...SEP }).bazaarCatalogUrl).toBe(DEFAULT_BAZAAR_CATALOG_URL);
    expect(loadConfig({ ...SEP, WEBCAP_BAZAAR_CATALOG_URL: 'https://bazaar.example.com' }).bazaarCatalogUrl).toBe(
      'https://bazaar.example.com',
    );
  });

  it('defaults artifact retention to disabled (0 days) and parses non-negative days', () => {
    expect(DEFAULT_ARTIFACT_RETENTION_DAYS).toBe(0);
    expect(loadConfig({ ...SEP }).artifactRetentionDays).toBe(DEFAULT_ARTIFACT_RETENTION_DAYS);
    // 0 is explicitly valid (disabled); positive values enable the sweep.
    expect(loadConfig({ ...SEP, WEBCAP_ARTIFACT_RETENTION_DAYS: '0' }).artifactRetentionDays).toBe(0);
    expect(loadConfig({ ...SEP, WEBCAP_ARTIFACT_RETENTION_DAYS: '30' }).artifactRetentionDays).toBe(30);
    expect(() => loadConfig({ ...SEP, WEBCAP_ARTIFACT_RETENTION_DAYS: '-1' })).toThrow(/invalid non-negative integer/);
    expect(() => loadConfig({ ...SEP, WEBCAP_ARTIFACT_RETENTION_DAYS: 'abc' })).toThrow(/invalid non-negative integer/);
  });

  it('sweeps artifacts on a 6h interval constant', () => {
    expect(ARTIFACT_SWEEP_INTERVAL_MS).toBe(6 * 3_600_000);
  });
});

describe('config: EIP-712 domains (single source: the CHAINS table)', () => {
  it('derives the x402 USDC signing domains byte-identically per network', () => {
    expect(EIP712_DOMAINS['eip155:84532']).toEqual({ name: 'USDC', version: '2' });
    expect(EIP712_DOMAINS['eip155:8453']).toEqual({ name: 'USD Coin', version: '2' });
    // Lock the exact literals (a mismatch makes every payment signature unrecoverable).
    expect(EIP712_DOMAINS['eip155:84532']?.name).toBe('USDC');
    expect(EIP712_DOMAINS['eip155:84532']?.version).toBe('2');
    expect(EIP712_DOMAINS['eip155:8453']?.name).toBe('USD Coin');
    expect(EIP712_DOMAINS['eip155:8453']?.version).toBe('2');
  });
});
