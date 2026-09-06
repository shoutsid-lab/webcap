import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { openDb, type Db } from '../../src/db/index.js';
import { makeArtifactRepo } from '../../src/db/artifacts.js';
import type { WebcapConfig } from '../../src/config.js';
import { buildApp } from '../../src/server/server.js';
import type { CaptureRequest, CaptureResult, PageStructure, StructuredCapture } from '../../src/capture/pipeline.js';
import { makeMockFacilitator, type MockFacilitator } from '../helpers/facilitator.js';

// Same sepolia fixture config as x402.capture.test.ts: the agent surfaces must
// be reachable without paying, so the fixture only needs a valid x402-enabled
// app (mock facilitator, no chain access).
const SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const MERCHANT_ADDRESS = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';

let dir: string;
let db: Db;
let app: FastifyInstance;
let mock: MockFacilitator;

const FAKE_STRUCTURE: PageStructure = {
  title: 'Example Domain',
  description: 'For use in examples.',
  headings: [{ level: 1, text: 'Example Domain' }],
  paragraphs: ['This domain is for use in illustrative examples.'],
  links: [{ href: 'https://www.iana.org/domains/example', text: 'More information...' }],
  images: [],
  wordCount: 9,
  markdown: '# Example Domain\n\nThis domain is for use in illustrative examples.',
};

const fakeCapture = async (req: CaptureRequest): Promise<CaptureResult> => ({
  buffer: Buffer.from('fake'),
  format: req.format ?? 'png',
  bytes: 4,
});

const fakeCaptureStructured = async (): Promise<StructuredCapture> => ({
  html: `<html><title>${FAKE_STRUCTURE.title}</title></html>`,
  structure: FAKE_STRUCTURE,
});

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'webcap-agent-surfaces-'));
  db = openDb(join(dir, 'surfaces.db'));
  mock = makeMockFacilitator('eip155:84532');
  const config: WebcapConfig = {
    chain: {
      name: 'base-sepolia',
      rpcUrl: 'https://sepolia.base.org',
      chainId: 84532,
      usdcContract: SEPOLIA_USDC,
      explorer: 'https://sepolia.basescan.org',
    },
    chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
    usdcAddress: SEPOLIA_USDC,
    merchantAddress: MERCHANT_ADDRESS,
    port: 0,
    pollIntervalMs: 5_000,
    merchantPrivateKey: '',
    dbPath: join(dir, 'surfaces.db'),
    x402Network: 'eip155:84532',
    x402Asset: SEPOLIA_USDC,
    x402PayTo: MERCHANT_ADDRESS,
    x402PriceUsdcUnits: 1_000,
    x402ExtractPriceUsdcUnits: 10_000,
    x402AuditPriceUsdcUnits: 2_000,
    computeCostUsdcUnitsPerRequest: 200,
    modelApiBaseUrl: '',
    modelApiKey: '',
    modelName: '',
    x402FacilitatorUrl: 'https://x402.org/facilitator',
    publicBaseUrl: 'http://localhost:8080',
    cdpApiKey: undefined,
  };
  app = buildApp({
    db,
    config,
    capture: fakeCapture,
    captureStructured: fakeCaptureStructured,
    og: async ({ url }) => ({ url, title: 'Stub' }),
    x402Facilitator: mock.facilitator,
    artifacts: makeArtifactRepo(db),
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('agent-facing discovery surfaces (free, no payment, no auth)', () => {
  it('GET /llms.txt serves the llms.txt convention document as markdown', async () => {
    const res = await app.inject({ method: 'GET', url: '/llms.txt' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    const body = res.body;
    expect(body).toContain('webcap');
    expect(body).toContain('/v1/x402/capture');
    expect(body).toContain('x402');
    // price rendered from the fixture config (x402PriceUsdcUnits = 1000)
    expect(body).toContain('$0.001');
    expect(body).toContain('/openapi.json');
    expect(body).toContain('/v1/x402/service');
  });

  it('GET /llms.txt documents the x402 flow, the price table, and the free preview', async () => {
    const res = await app.inject({ method: 'GET', url: '/llms.txt' });
    expect(res.statusCode).toBe(200);
    const body = res.body;
    expect(body).toContain('/v1/x402/extract');
    expect(body).toContain('$0.01');
    expect(body).toContain('/v1/x402/watches/topup');
    expect(body).toContain('EIP-3009');
    expect(body).toContain('PAYMENT-SIGNATURE');
    expect(body).toContain('/v1/extract/preview');
  });

  it('GET /skill.md serves an installable agent skill file with valid frontmatter', async () => {
    const res = await app.inject({ method: 'GET', url: '/skill.md' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    const body = res.body;
    expect(body.startsWith('---')).toBe(true);
    const frontmatter = body.split('---')[1] ?? '';
    expect(frontmatter).toContain('name: webcap');
    expect(frontmatter).toContain('description:');
  });

  it('GET /skill.md teaches the x402 payment flow, pricing, and the free-preview alternative', async () => {
    const res = await app.inject({ method: 'GET', url: '/skill.md' });
    expect(res.statusCode).toBe(200);
    const body = res.body;
    expect(body).toContain('x402');
    expect(body).toContain('PAYMENT-SIGNATURE');
    expect(body).toContain('@x402/axios');
    expect(body).toContain('wrapAxiosWithPayment');
    expect(body).toContain('$0.001');
    expect(body).toContain('/v1/extract/preview');
    expect(body).toContain('detail.paidUpgrade');
    expect(body).toContain('POST /v1/x402/extract');
  });
});
