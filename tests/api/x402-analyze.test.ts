import { describe, expect, it } from 'vitest';
import type { WebcapConfig } from '../../src/config.js';
import { buildX402Routes, X402_ANALYZE_BATCH_PATH, X402_ANALYZE_PATH } from '../../src/server/x402.js';
import { isMppPaidPattern } from '../../src/mpp/plugin.js';
import { deterministicAnalyze } from '../../src/ml/deterministic.js';
import type { PageStructure } from '../../src/capture/pipeline.js';
import { closeApiFixture, makeApiFixture } from './fixture.js';

const SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const MERCHANT_ADDRESS = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';

function makeConfig(): WebcapConfig {
  return {
    chain: { name: 'base-sepolia', rpcUrl: 'https://sepolia.base.org', chainId: 84532, usdcContract: SEPOLIA_USDC, explorer: 'https://sepolia.basescan.org' },
    chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
    usdcAddress: SEPOLIA_USDC,
    merchantAddress: MERCHANT_ADDRESS,
    port: 0,
    pollIntervalMs: 5_000,
    merchantPrivateKey: '',
    dbPath: 'data/webcap.db',
    x402Network: 'eip155:84532',
    x402Asset: SEPOLIA_USDC,
    x402PayTo: MERCHANT_ADDRESS,
    x402PriceUsdcUnits: 1_000,
    x402ExtractPriceUsdcUnits: 10_000,
    x402AuditPriceUsdcUnits: 2_000,
    x402VideoPriceUsdcUnits: 5_000,
    computeCostUsdcUnitsPerRequest: 200,
    modelApiBaseUrl: '',
    modelApiKey: '',
    modelName: '',
    x402FacilitatorUrl: 'https://x402.org/facilitator',
    publicBaseUrl: 'http://localhost:8080',
    cdpApiKey: undefined,
  };
}

const STUB_STRUCTURE: PageStructure = {
  title: 'Acme Shop — Buy great widgets',
  description: 'The best widgets online. Free shipping.',
  headings: [{ level: 1, text: 'Buy great widgets' }, { level: 2, text: 'Pricing' }],
  paragraphs: ['Our widgets are great and excellent. Buy now for $19.99. Contact us at hello@acme.test.'],
  links: [{ href: 'https://acme.test/cart', text: 'Cart' }, { href: 'https://acme.test/', text: '' }],
  images: [{ src: 'https://acme.test/logo.png', alt: '' }],
  wordCount: 42,
  markdown: '# Buy great widgets\n\nOur widgets are great and excellent. Buy now for $19.99.',
};
const STUB_HTML = '<html><head><title>Acme Shop</title></head><body><h1>Buy great widgets</h1><img src="/logo.png"></body></html>';

describe('POST /v1/x402/analyze x402 wiring', () => {
  it('registers analyze + batch in the x402 route table at the extract price tier', async () => {
    const routes = buildX402Routes(makeConfig());
    for (const pattern of ['POST /v1/x402/analyze', 'GET /v1/x402/analyze', 'POST /v1/x402/analyze/batch', 'GET /v1/x402/analyze/batch']) {
      const route = routes[pattern];
      expect(route, `${pattern} must be x402-gated`).toBeDefined();
      const accepts = route?.accepts as { price?: { amount?: string } };
      const price = accepts.price as { amount?: string };
      expect(price?.amount).toBe('10000');
    }
  });

  it('covers analyze paths in the MPP paid-pattern gate at the extract price', async () => {
    expect(isMppPaidPattern('POST', X402_ANALYZE_PATH)).toBe(true);
    expect(isMppPaidPattern('POST', X402_ANALYZE_BATCH_PATH)).toBe(true);
    expect(isMppPaidPattern('GET', X402_ANALYZE_PATH)).toBe(true);
  });

  it('returns 503 x402_disabled on local chain (handler exists, payment rail off)', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({
        method: 'POST',
        url: '/v1/x402/analyze',
        headers: { 'content-type': 'application/json' },
        payload: { url: 'https://example.com/', task: 'classification' },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ error: { code: 'x402_disabled', message: 'x402 payment requires WEBCAP_CHAIN=base-sepolia or base' } });
    } finally {
      await closeApiFixture(fx);
    }
  });
});

describe('deterministicAnalyze (no-model fallback)', () => {
  it('classification returns a category + confidence without a model', async () => {
    const result = deterministicAnalyze({ structure: STUB_STRUCTURE, html: STUB_HTML, pageUrl: 'https://acme.test/', task: 'classification' }) as { category: string; confidence: number; mode: string };
    expect(typeof result.category).toBe('string');
    expect(typeof result.confidence).toBe('number');
    expect(result.mode).toBe('deterministic');
  });

  it('classification honors og:type article over keyword guesses', async () => {
    const html = '<html><head><meta property="og:type" content="article"></head><body></body></html>';
    const result = deterministicAnalyze({ structure: STUB_STRUCTURE, html, pageUrl: 'https://acme.test/', task: 'classification' }) as { category: string; confidence: number };
    expect(result.category).toBe('article');
    expect(result.confidence).toBe(0.8);
  });

  it('classification uses the URL path for docs pages', async () => {
    const result = deterministicAnalyze({ structure: STUB_STRUCTURE, html: '', pageUrl: 'https://acme.test/docs/quickstart', task: 'classification' }) as { category: string };
    expect(result.category).toBe('documentation');
  });

  it('accessibility flags the missing alt text + empty link text', async () => {
    const result = deterministicAnalyze({ structure: STUB_STRUCTURE, html: STUB_HTML, pageUrl: 'https://acme.test/', task: 'accessibility' }) as { score: number; issues: Array<{ type: string }> };
    expect(typeof result.score).toBe('number');
    expect(result.issues.some((i) => i.type === 'missing-alt')).toBe(true);
    expect(result.issues.some((i) => i.type === 'empty-link-text')).toBe(true);
  });

  it('entities extracts the email, price, and urls', async () => {
    const result = deterministicAnalyze({ structure: STUB_STRUCTURE, html: STUB_HTML, pageUrl: 'https://acme.test/', task: 'entities' }) as { entities: Array<{ type: string; value: string }> };
    expect(result.entities.some((e) => e.type === 'email' && e.value.includes('hello@acme.test'))).toBe(true);
    expect(result.entities.some((e) => e.type === 'price')).toBe(true);
    expect(result.entities.some((e) => e.type === 'url')).toBe(true);
  });

  it('sentiment detects the positive marketing copy', async () => {
    const result = deterministicAnalyze({ structure: STUB_STRUCTURE, html: STUB_HTML, pageUrl: 'https://acme.test/', task: 'sentiment' }) as { sentiment: string };
    expect(result.sentiment).toBe('positive');
  });

  it('layout reports hierarchy + readability without a model', async () => {
    const result = deterministicAnalyze({ structure: STUB_STRUCTURE, html: STUB_HTML, pageUrl: 'https://acme.test/', task: 'layout' }) as { hierarchy: string; readabilityScore: number };
    expect(result.hierarchy).toBe('medium');
    expect(typeof result.readabilityScore).toBe('number');
  });
});
