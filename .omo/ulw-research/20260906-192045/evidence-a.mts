/**
 * Wave-4 gate evidence script Part A (read-only on repo; writes ONLY to journal dir).
 * Run: npx tsx /tmp/opencode/evidence/evidence-a.ts
 * Covers: S1 paid audit JSON, 402 challenge amounts, S2/S3 debugger HTML dumps,
 *         scorer determinism vector, S4 422-before-charge (+width:100 probe).
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import axios from 'axios';
import { privateKeyToAccount } from 'viem/accounts';
import { ExactEvmScheme } from '@x402/evm';
import { x402Client, wrapAxiosWithPayment } from '@x402/axios';
import { openDb } from '../../../src/db/index.js';
import { makeArtifactRepo } from '../../../src/db/artifacts.js';
import { buildApp } from '../../../src/server/server.js';
import { makeMockFacilitator } from '../../../tests/helpers/facilitator.js';
import {
  closeApiFixture,
  makeApiFixture,
} from '../../../tests/api/fixture.js';
import type { OgResult } from '../../../src/capture/og.js';
import { computeOgScore } from '../../../src/capture/og-score.js';

const J = '/home/shoutsid/code/webcap/.omo/ulw-research/20260906-192045';
mkdirSync(J, { recursive: true });
const out: Record<string, unknown> = {};
const save = (name: string, data: string | Buffer) => {
  writeFileSync(join(J, name), data);
  out[name] = `${join(J, name)} (${Buffer.byteLength(data)} bytes)`;
};

// ---------- S1: paid audit via mock facilitator (ephemeral listen, torn down) ----------
const SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const MERCHANT_ADDRESS = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';
const PAYER_KEY_A = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b786900';
const GOOD_URL = 'https://example.com/';

{
  const dir = mkdtempSync(join(tmpdir(), 'webcap-ev-audit-'));
  const db = openDb(join(dir, 'audit.db'));
  const mock = makeMockFacilitator('eip155:84532');
  const config: any = {
    chain: { name: 'base-sepolia', rpcUrl: 'https://sepolia.base.org', chainId: 84532, usdcContract: SEPOLIA_USDC, explorer: '' },
    chainId: 84532, rpcUrl: 'https://sepolia.base.org', usdcAddress: SEPOLIA_USDC, merchantAddress: MERCHANT_ADDRESS,
    port: 0, pollIntervalMs: 5_000, merchantPrivateKey: '', dbPath: join(dir, 'audit.db'),
    x402Network: 'eip155:84532', x402Asset: SEPOLIA_USDC, x402PayTo: MERCHANT_ADDRESS,
    x402PriceUsdcUnits: 1_000, x402ExtractPriceUsdcUnits: 10_000, x402AuditPriceUsdcUnits: 2000,
    computeCostUsdcUnitsPerRequest: 200, modelApiBaseUrl: '', modelApiKey: '', modelName: '',
    x402FacilitatorUrl: 'https://x402.org/facilitator', publicBaseUrl: 'http://localhost:8080', cdpApiKey: undefined,
  };
  const app = buildApp({
    db, config,
    capture: async () => { throw new Error('not used'); },
    captureStructured: async (req: any) => ({
      html: `<html><head><title>T</title></head><body><a href="${req.url}">self</a></body></html>`,
      structure: { title: 'T', description: '', headings: [], paragraphs: [], links: [{ href: req.url, text: 'self' }], images: [], wordCount: 1, markdown: 'T' },
    }),
    og: async ({ url }: any) => ({ url, title: 'Stub' }),
    x402Facilitator: mock.facilitator,
    artifacts: makeArtifactRepo(db),
  });
  const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  try {
    const account = privateKeyToAccount(PAYER_KEY_A);
    const client = new x402Client().register('eip155:*', new ExactEvmScheme(account));
    const api = wrapAxiosWithPayment(axios.create({ baseURL: baseUrl }), client);
    const res = await api.post('/v1/x402/audit', { url: GOOD_URL });
    save('s1-audit-paid.json', JSON.stringify(res.data, null, 2));
    const sample = (res.data as any).audit.links.sample as Array<{ href: string; text: string }>;
    out['s1-binary'] = {
      status: res.status,
      everyItemHasHrefAndText: sample.every((i) => typeof i.href === 'string' && typeof i.text === 'string'),
      oldStringShape: typeof sample[0] === 'string',
      sample,
      priceUsdcUnits: (res.data as any).payment?.priceUsdcUnits,
    };
    // 402 amounts (byte-identity of price dimension)
    const amounts: Record<string, string> = {};
    for (const [name, method, url, payload] of [
      ['capture', 'post', '/v1/x402/capture', { url: GOOD_URL }],
      ['extract', 'post', '/v1/x402/extract', { url: GOOD_URL }],
      ['audit', 'post', '/v1/x402/audit', { url: GOOD_URL }],
    ] as const) {
      const r = await app.inject({ method: method as 'post', url, payload });
      amounts[name] = `${r.statusCode}:${(r.json() as any).accepts?.[0]?.amount}`;
    }
    const topup = await app.inject({ method: 'POST', url: '/v1/x402/watches/topup?watchId=w1', payload: {} });
    amounts['watches-topup'] = `${topup.statusCode}:${(topup.json() as any).accepts?.[0]?.amount}`;
    out['amounts-402'] = amounts;
  } finally {
    await app.close();
    db.close();
  }
}

// ---------- S2/S3: debugger HTML dumps via inject (stubbed og, no network) ----------
const RICH: OgResult = {
  url: 'https://example.com/', title: 'Twitter Rich Title', description: 'Twitter Rich Description', image: '/twitter-rich.png',
  twitterCard: 'summary_large_image', twitterSite: '@webcap', twitterCreator: '@author',
  twitterTitle: 'Twitter Rich Title', twitterDescription: 'Twitter Rich Description', twitterImage: '/twitter-rich.png',
  articlePublishedTime: '2026-01-02T03:04:05Z', articleAuthor: 'Jane Author', articleSection: 'Technology',
  articleTags: ['web', 'og'],
} as OgResult;
{
  const fx = makeApiFixture({ og: async (req) => ({ ...RICH, url: req.url }) });
  try {
    const res = await fx.app.inject({ method: 'GET', url: '/og-debugger?url=https://example.com/' });
    save('s2-debugger-tag-rich.html', res.payload);
    const rows = ['twitter:title', 'twitter:card', 'twitter:image', 'article:published_time', 'article:author', 'Jane Author'];
    out['s2-binary'] = { status: res.statusCode, rowsPresent: Object.fromEntries(rows.map((r) => [r, res.payload.includes(r)])) };
  } finally {
    await closeApiFixture(fx);
  }
}
{
  const poor = makeApiFixture({ og: async (req) => ({ url: req.url }) });
  try {
    const res = await poor.app.inject({ method: 'GET', url: '/og-debugger?url=https://example.com/' });
    save('s3-debugger-tag-poor.html', res.payload);
    const m = res.payload.match(/Preview score[^<]*<[^>]*>\s*(\d+)\s*\/\s*100/) ?? res.payload.match(/(\d+)\s*\/\s*100/);
    out['s3-poor-binary'] = {
      status: res.statusCode, score: m?.[1] ?? null, below50: m ? Number(m[1]) < 50 : null,
      hasStrongCTA: res.payload.includes('Fix this preview'),
      hasHintBand: ['WhatsApp', 'Discord', 'Slack'].every((w) => res.payload.includes(w)),
    };
  } finally {
    await closeApiFixture(poor);
  }
}
{
  const rich = makeApiFixture({
    og: async (req) => ({
      url: req.url, title: 'A tidy title well under sixty chars',
      description: 'A tidy description well under one hundred and sixty characters for link previews.',
      image: 'https://example.com/og.png', twitterCard: 'summary_large_image', twitterSite: '@webcap',
      twitterCreator: '@author', twitterTitle: 'A tidy title', twitterDescription: 'A tidy description',
      twitterImage: 'https://example.com/og.png', icon: 'https://example.com/icon.png',
    }),
  });
  try {
    const res = await rich.app.inject({ method: 'GET', url: '/og-debugger?url=https://example.com/' });
    save('s3-debugger-tag-rich.html', res.payload);
    const m = res.payload.match(/(\d+)\s*\/\s*100/);
    out['s3-rich-binary'] = {
      status: res.statusCode, score: m?.[1] ?? null, atLeast80: m ? Number(m[1]) >= 80 : null,
      hasStrongCTA: res.payload.includes('Fix this preview'), hasSoftCTA: res.payload.includes('Need this at scale?'),
    };
  } finally {
    await closeApiFixture(rich);
  }
}
// ---------- S3: scorer determinism vector (pure function, no I/O) ----------
{
  const poor = { url: 'https://example.com/' } as OgResult;
  const a = computeOgScore(poor);
  const b = computeOgScore(poor);
  const richScore = computeOgScore(RICH);
  const vector = { poor: a, poorRepeat: b, rich: richScore, deterministic: JSON.stringify(a) === JSON.stringify(b) };
  save('s3-scorer-vector.json', JSON.stringify(vector, null, 2));
  out['s3-vector-binary'] = {
    deterministic: vector.deterministic,
    poorInBounds: a.score >= 0 && a.score <= 100,
    richInBounds: richScore.score >= 0 && richScore.score <= 100,
    poorScore: a.score, richScore: richScore.score,
  };
}
// ---------- S4: 422-before-charge via credit route (inject) + width:100 probe ----------
{
  const fx = makeApiFixture();
  try {
    fx.credits.grantCredits(fx.accountId, 1, 'test_seed');
    const bad = await fx.app.inject({
      method: 'POST', url: '/v1/capture',
      payload: { url: 'https://example.com/', options: { viewport: { width: 1280.5, height: 800 } } },
      headers: { authorization: `Bearer ${fx.apiKey}` },
    });
    save('s4-422-envelope.json', JSON.stringify({ status: bad.statusCode, body: bad.json() }, null, 2));
    out['s4-422-binary'] = { status: bad.statusCode, balanceAfter: fx.accounts.getBalance(fx.accountId), balanceDelta: 1 - fx.accounts.getBalance(fx.accountId) };
    // contract probe: below-floor integer width (implementation clamps per capture-parse.ts:39)
    const probe = await fx.app.inject({
      method: 'POST', url: '/v1/capture',
      payload: { url: 'https://example.com/', options: { viewport: { width: 100, height: 100 } } },
      headers: { authorization: `Bearer ${fx.apiKey}` },
    });
    out['s4-width100-probe'] = { status: probe.statusCode, code: (probe.json() as any)?.error?.code ?? '(200 path)', balanceAfter: fx.accounts.getBalance(fx.accountId) };
  } finally {
    await closeApiFixture(fx);
  }
}

save('evidence-a-summary.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
