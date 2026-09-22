import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../../src/db/index.js';
import { makeArtifactRepo } from '../../src/db/artifacts.js';
import type { WebcapConfig } from '../../src/config.js';
import { buildApp } from '../../src/server/server.js';
import type { CaptureRequest, CaptureResult, PageStructure, StructuredCapture } from '../../src/capture/pipeline.js';
import { makeMockFacilitator, type MockFacilitator } from '../helpers/facilitator.js';

// The agent customer pays over MPP as well as x402, so the two documents an
// LLM actually reads (/llms.txt, /skill.md) must advertise the MPP rail exactly
// when this deployment enables it (MPP_SECRET_KEY set) — and stay x402-only
// otherwise, because a surface that lies to an agent costs a real call.

const SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const MERCHANT_ADDRESS = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';
const PUBLIC_BASE_URL = 'http://localhost:8080';
const REALM = 'localhost:8080';
const MPP_SECRET = 'ab'.repeat(32); // 64 bare-hex chars -> 32 bytes, enables MPP

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

let dir: string;
let db: Db;
let mock: MockFacilitator;
let app: FastifyInstance;
const savedSecret = process.env.MPP_SECRET_KEY;

function makeConfig(): WebcapConfig {
  return {
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
    dbPath: join(dir, 'surfaces-mpp.db'),
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
    publicBaseUrl: PUBLIC_BASE_URL,
    cdpApiKey: undefined,
  };
}

/** Build an app with MPP_SECRET_KEY set (or deleted) before registration reads env. */
function buildAppWithMpp(secret: string | undefined): FastifyInstance {
  if (secret === undefined) delete process.env.MPP_SECRET_KEY;
  else process.env.MPP_SECRET_KEY = secret;
  return buildApp({
    db,
    config: makeConfig(),
    capture: fakeCapture,
    captureStructured: fakeCaptureStructured,
    og: async ({ url }) => ({ url, title: 'Stub' }),
    x402Facilitator: mock.facilitator,
    artifacts: makeArtifactRepo(db),
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'webcap-agent-surfaces-mpp-'));
  db = openDb(join(dir, 'surfaces-mpp.db'));
  mock = makeMockFacilitator('eip155:84532');
});

afterEach(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
  if (savedSecret === undefined) delete process.env.MPP_SECRET_KEY;
  else process.env.MPP_SECRET_KEY = savedSecret;
});

describe('agent surfaces advertise the MPP rail only when it is enabled', () => {
  it('stays x402-only when MPP_SECRET_KEY is unset', async () => {
    app = buildAppWithMpp(undefined);
    await app.ready();
    const llms = await app.inject({ method: 'GET', url: '/llms.txt' });
    const skill = await app.inject({ method: 'GET', url: '/skill.md' });
    expect(llms.statusCode).toBe(200);
    expect(skill.statusCode).toBe(200);
    expect(llms.body).not.toContain('MPP');
    expect(skill.body).not.toContain('MPP');
  });

  it('documents the MPP challenge when MPP_SECRET_KEY enables it', async () => {
    app = buildAppWithMpp(MPP_SECRET);
    await app.ready();
    const llms = await app.inject({ method: 'GET', url: '/llms.txt' });
    const skill = await app.inject({ method: 'GET', url: '/skill.md' });
    expect(llms.statusCode).toBe(200);
    expect(skill.statusCode).toBe(200);
    for (const body of [llms.body, skill.body]) {
      expect(body).toContain('MPP');
      expect(body).toContain('WWW-Authenticate: Payment');
      expect(body).toContain('EIP-3009');
      // realm is the bare host of the configured base URL
      expect(body).toContain(REALM);
      // truthful: still advertises x402 as the primary rail
      expect(body).toContain('x402');
    }
  });
});
