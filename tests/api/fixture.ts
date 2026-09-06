import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { openDb, type Db } from '../../src/db/index.js';
import { makeAccountsRepo, type AccountsRepo } from '../../src/db/accounts.js';
import { makeApiKeysRepo, type ApiKeysRepo } from '../../src/db/api_keys.js';
import { makeCreditsRepo, type CreditsRepo } from '../../src/db/credits.js';
import { makeInvoicesRepo, type InvoicesRepo } from '../../src/db/invoices.js';
import { makeArtifactRepo } from '../../src/db/artifacts.js';
import type { WebcapConfig } from '../../src/config.js';
import { generateApiKey, hashKey } from '../../src/util/keys.js';
import { buildApp } from '../../src/server/server.js';
import type { CaptureRequest, CaptureResult, PageStructure, StructuredCapture } from '../../src/capture/pipeline.js';
import type { OgResult } from '../../src/capture/og.js';

import { Wallet } from 'ethers';

// anvil account #1 (public test key)
export const MERCHANT_PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b786900';
export const MERCHANT_ADDRESS = new Wallet(MERCHANT_PRIVATE_KEY).address;
export const CUSTOMER_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
export const USDC_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

export const FAKE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const FAKE_STRUCTURE: PageStructure = {
  title: 'Stub Title',
  description: 'Stub description',
  headings: [{ level: 1, text: 'Heading One' }],
  paragraphs: ['A stub paragraph.'],
  links: [{ href: 'https://example.com/', text: 'home' }],
  images: [{ src: 'https://example.com/i.png', alt: 'stub' }],
  wordCount: 4,
  markdown: '# Stub Title\n\nA stub paragraph.',
};
const FAKE_HTML = '<html><head><title>Stub Title</title></head><body><h1>Heading One</h1></body></html>';

export interface ApiFixture {
  readonly app: FastifyInstance;
  readonly db: Db;
  readonly accounts: AccountsRepo;
  readonly keys: ApiKeysRepo;
  readonly credits: CreditsRepo;
  readonly invoices: InvoicesRepo;
  readonly config: WebcapConfig;
  readonly apiKey: string;
  readonly accountId: number;
  readonly dir: string;
}

export interface FixtureOverrides {
  readonly capture?: (req: CaptureRequest) => Promise<CaptureResult>;
  readonly captureStructured?: (req: CaptureRequest) => Promise<StructuredCapture>;
  readonly og?: (req: { url: string }) => Promise<OgResult>;
  /** Pino options for the fixture app (default: logging disabled). */
  readonly loggerOptions?: FastifyServerOptions['logger'];
}

export function makeApiFixture(overrides: FixtureOverrides = {}): ApiFixture {
  const dir = mkdtempSync(join(tmpdir(), 'webcap-api-'));
  const db = openDb(join(dir, 'test.db'));
  const config: WebcapConfig = {
    chain: { name: 'local', rpcUrl: 'http://127.0.0.1:8545', chainId: 31337, usdcContract: USDC_ADDRESS, explorer: '' },
    chainId: 31337,
    rpcUrl: 'http://127.0.0.1:8545',
    usdcAddress: USDC_ADDRESS,
    merchantAddress: MERCHANT_ADDRESS,
    port: 0,
    pollIntervalMs: 5_000,
    merchantPrivateKey: MERCHANT_PRIVATE_KEY,
    dbPath: join(dir, 'test.db'),
    x402Network: undefined,
    x402Asset: USDC_ADDRESS,
    x402PayTo: MERCHANT_ADDRESS,
    x402PriceUsdcUnits: 1_000,
    x402ExtractPriceUsdcUnits: 10_000,
    computeCostUsdcUnitsPerRequest: 200,
    modelApiBaseUrl: '',
    modelApiKey: '',
    modelName: '',
    x402FacilitatorUrl: 'https://x402.org/facilitator',
    publicBaseUrl: 'http://localhost:8080',
    cdpApiKey: undefined,
  };
  const accounts = makeAccountsRepo(db);
  const keys = makeApiKeysRepo(db);
  const accountId = accounts.create(CUSTOMER_ADDRESS);
  const apiKey = generateApiKey();
  keys.create(accountId, hashKey(apiKey));
  const capture =
    overrides.capture ??
    (async (req: CaptureRequest): Promise<CaptureResult> => ({
      buffer: FAKE_PNG,
      format: req.format ?? 'png',
      bytes: FAKE_PNG.length,
    }));
  const captureStructured =
    overrides.captureStructured ?? (async (): Promise<StructuredCapture> => ({ html: FAKE_HTML, structure: FAKE_STRUCTURE }));
  const og = overrides.og ?? (async (req: { url: string }): Promise<OgResult> => ({ url: req.url, title: 'Stub Title' }));
  const app = buildApp({ db, config, capture, captureStructured, og, artifacts: makeArtifactRepo(db), loggerOptions: overrides.loggerOptions });
  return {
    app,
    db,
    accounts,
    keys,
    credits: makeCreditsRepo(db),
    invoices: makeInvoicesRepo(db),
    config,
    apiKey,
    accountId,
    dir,
  };
}

export async function closeApiFixture(fx: ApiFixture): Promise<void> {
  await fx.app.close();
  fx.db.close();
  rmSync(fx.dir, { recursive: true, force: true });
}

export interface ErrorEnvelope {
  readonly code: string;
  readonly message: string;
  readonly detail?: Record<string, unknown>;
}

/** Parse the {error:{code,message,detail?}} envelope from a fastify response. */
export function errorEnvelope(res: { json(): unknown }): ErrorEnvelope {
  const parsed = res.json() as { error: ErrorEnvelope };
  return parsed.error;
}
