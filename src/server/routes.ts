import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { getAddress, Wallet, ZeroAddress } from 'ethers';
import { makeAccountsRepo } from '../db/accounts.js';
import { makeApiKeysRepo } from '../db/api_keys.js';
import { makeCreditsRepo } from '../db/credits.js';
import { makeInvoicesRepo, type InvoiceRow } from '../db/invoices.js';
import {
  CAPTURE_COST_CREDITS,
  CREDITS_PER_USDC,
  PACKS,
  PRICE_PER_CREDIT,
  USDC_SCALE,
  USDC_UNITS_PER_CREDIT,
  WATCH_TOPUP_RUNS,
  usdcForCredits,
  usdcUnitsForCredits,
  watchTopUpPriceUsdcUnits,
  type WebcapConfig,
} from '../config.js';
import { CaptureError } from '../capture/errors.js';
import { HttpError, unprocessable } from '../util/errors.js';
import { generateApiKey, hashKey } from '../util/keys.js';
import { isRecord, parseFormat, parseOptions, validatedUrl } from './capture-parse.js';
import { x402Payer } from './x402.js';
import { authenticate } from './auth.js';
import { makeRevenueRepo } from '../db/revenue.js';
import { RateLimiter } from '../util/ratelimit.js';
import { modelExtract } from '../extract/model.js';
import type { CaptureFormat, CaptureResult, StructuredCapture } from '../capture/pipeline.js';
import { parseExtractSchema, parseExtractUrls, type ExtractedContent, type ExtractResult } from './extract-parse.js';
import type { AppDeps } from './server.js';
import { landingHtml, artifactPageHtml } from './pages.js';
import { openapiDocument } from './openapi.js';

const PREVIEW_RATE_LIMIT = 10;
const PREVIEW_RATE_WINDOW_MS = 60_000;
const MIME_BY_FORMAT: Record<CaptureFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  pdf: 'application/pdf',
};

export function registerRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, config } = deps;
  const accounts = makeAccountsRepo(db);
  const keys = makeApiKeysRepo(db);
  const credits = makeCreditsRepo(db);
  const invoices = makeInvoicesRepo(db);
  const revenue = makeRevenueRepo(db);
  const merchantAddress = merchantAddressOf(config);
  const allowHosts = deps.captureAllowHosts;
  const previewLimiter = new RateLimiter(PREVIEW_RATE_LIMIT, PREVIEW_RATE_WINDOW_MS);

  const storeArtifact = (sourceUrl: string, result: CaptureResult): string => {
    const id = crypto.randomUUID();
    deps.artifacts.store({
      id,
      sourceUrl,
      format: result.format,
      mime: MIME_BY_FORMAT[result.format],
      bytes: result.buffer,
    });
    return `${config.publicBaseUrl}/v1/artifacts/${id}`;
  };

  // Content negotiation: pure-JSON clients (Accept: application/json without
  // text/html) keep getting the JSON front-door payload, byte-for-byte;
  // everyone else gets the product landing page.
  app.get('/', async (req, reply) => {
    if (wantsJsonOnly(acceptOf(req.headers.accept))) {
      return frontDoorPayload(config);
    }
    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(landingHtml(config));
  });

  app.get('/openapi.json', async () => openapiDocument(config));

  app.get('/v1/health', async () => ({
    ok: true,
    chainId: config.chain.chainId,
    creditsPerUsdc: CREDITS_PER_USDC,
    pricePerCredit: PRICE_PER_CREDIT,
  }));

  // Service icon referenced by the x402 bazaar resource.iconUrl.
  app.get('/icon.png', async (_req, reply) => {
    const icon = loadIconPng();
    if (icon === undefined) {
      throw new HttpError(500, 'internal', 'service icon is missing');
    }
    reply.header('content-type', 'image/png');
    reply.header('cache-control', 'public, max-age=86400');
    return reply.send(icon);
  });

  // SEO surface: robots.txt + sitemap.xml, both driven by config.publicBaseUrl.
  app.get('/robots.txt', async (_req, reply) => {
    reply.header('content-type', 'text/plain; charset=utf-8');
    return reply.send(`User-agent: *\nAllow: /\nSitemap: ${config.publicBaseUrl}/sitemap.xml\n`);
  });

  app.get('/sitemap.xml', async (_req, reply) => {
    reply.header('content-type', 'application/xml; charset=utf-8');
    return reply.send(sitemapXml(config));
  });

  app.get('/.well-known/x402', async (_req, reply) => {
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('cache-control', 'public, max-age=300');
    return reply.send(x402WellKnown(config));
  });

  app.get('/.well-known/agent-card.json', async (_req, reply) => {
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('cache-control', 'public, max-age=300');
    return reply.send(agentCard(config));
  });

  app.post('/v1/register', async (req, reply) => {
    const raw = isRecord(req.body) ? req.body.address : undefined;
    if (typeof raw !== 'string') throw unprocessable('address is required');
    let address: string;
    try {
      address = getAddress(raw);
    } catch {
      throw unprocessable('invalid address');
    }
    const accountId = accounts.findByAddress(address) ?? accounts.create(address);
    const apiKey = generateApiKey();
    keys.create(accountId, hashKey(apiKey));
    return reply.status(201).send({ address, apiKey, balance: 0 });
  });

  app.post('/v1/invoice', async (req, reply) => {
    const { account } = authenticate(req, db);
    const creditsAmount = parseCredits(req.body);
    const invoice = createInvoice(invoices, config, merchantAddress, account.id, creditsAmount);
    return reply.status(201).send({
      invoiceId: String(invoice.id),
      merchant: merchantAddress,
      token: config.chain.usdcContract,
      chainId: config.chain.chainId,
      requiredUsdc: usdcForCredits(creditsAmount),
      credits: creditsAmount,
      expiresAt: invoice.expires_at,
    });
  });

  app.post('/v1/capture', async (req) => {
    const { account } = authenticate(req, db);
    const body = req.body;
    const rawUrl = isRecord(body) ? body.url : undefined;
    if (typeof rawUrl !== 'string') throw unprocessable('url is required');
    const normalized = validatedUrl(rawUrl, allowHosts);
    const format = parseFormat(body);
    const options = parseOptions(body);

    const balanceBefore = accounts.getBalance(account.id);
    if (balanceBefore < CAPTURE_COST_CREDITS) {
      const topUp = createInvoice(invoices, config, merchantAddress, account.id, CAPTURE_COST_CREDITS);
      throw new HttpError(402, 'insufficient_credits', 'insufficient credits', {
        invoiceId: String(topUp.id),
        requiredUsdc: usdcForCredits(CAPTURE_COST_CREDITS),
        balance: balanceBefore,
      });
    }
    if (!credits.recordCharge(account.id)) {
      throw new HttpError(402, 'insufficient_credits', 'insufficient credits', { balance: 0 });
    }

    let result;
    try {
      result = await deps.capture({ url: normalized, format, options });
    } catch (err) {
      credits.grantCredits(account.id, CAPTURE_COST_CREDITS, 'capture_refunded', req.id);
      if (err instanceof CaptureError) throw new HttpError(502, 'capture_failed', err.message);
      throw err;
    }
    const url = storeArtifact(normalized, result);
    return {
      artifact: { format: result.format, bytes: result.bytes, data: result.buffer.toString('base64'), url },
      creditsCharged: CAPTURE_COST_CREDITS,
      balance: accounts.getBalance(account.id),
    };
  });

  app.post('/v1/x402/capture', async (req) => {
    if (config.x402Network === undefined) {
      throw new HttpError(503, 'x402_disabled', 'x402 payment requires WEBCAP_CHAIN=base-sepolia or base');
    }
    const body = req.body;
    const rawUrl = isRecord(body) ? body.url : undefined;
    if (typeof rawUrl !== 'string') throw unprocessable('url is required');
    const normalized = validatedUrl(rawUrl, allowHosts);
    const format = parseFormat(body);
    const options = parseOptions(body);

    let result;
    try {
      result = await deps.capture({ url: normalized, format, options });
    } catch (err) {
      if (err instanceof CaptureError) throw new HttpError(502, 'capture_failed', err.message);
      throw err;
    }
    const payer = x402Payer(req) ?? 'unknown';
    revenue.record({
      endpoint: 'capture',
      payer,
      revenueUsdcUnits: config.x402PriceUsdcUnits,
      costUsdcUnits: config.computeCostUsdcUnitsPerRequest,
    });
    const url = storeArtifact(normalized, result);
    return {
      artifact: { format: result.format, bytes: result.bytes, data: result.buffer.toString('base64'), url },
      payment: { payer, priceUsdcUnits: config.x402PriceUsdcUnits },
    };
  });

  app.get('/v1/artifacts/:id', async (req, reply) => {
    const rawId = isRecord(req.params) ? req.params.id : undefined;
    if (typeof rawId !== 'string') throw unprocessable('id is required');
    const artifact = deps.artifacts.get(rawId);
    if (artifact === null) throw new HttpError(404, 'not_found', 'artifact not found');
    reply.header('content-type', artifact.mime);
    reply.header('content-length', artifact.bytes.length);
    return reply.send(artifact.bytes);
  });

  // Shareable artifact page: same lookup + 404 semantics as the raw route above,
  // renders Open Graph tags for link previews.
  app.get('/v1/artifacts/:id/page', async (req, reply) => {
    const rawId = isRecord(req.params) ? req.params.id : undefined;
    if (typeof rawId !== 'string') throw unprocessable('id is required');
    const artifact = deps.artifacts.get(rawId);
    if (artifact === null) throw new HttpError(404, 'not_found', 'artifact not found');
    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(artifactPageHtml(config, artifact));
  });

  app.post('/v1/x402/extract', async (req) => {
    if (config.x402Network === undefined) {
      throw new HttpError(503, 'x402_disabled', 'x402 payment requires WEBCAP_CHAIN=base-sepolia or base');
    }
    const urls = parseExtractUrls(req.body, allowHosts);
    const schema = parseExtractSchema(req.body);
    const wantsModel =
      schema !== undefined && config.modelApiKey !== '' && config.modelApiBaseUrl !== '' && config.modelName !== '';
    const results: ExtractResult[] = [];
    let failures = 0;
    for (const url of urls) {
      let captured: StructuredCapture;
      try {
        captured = await deps.captureStructured({ url, options: { includeHtml: wantsModel } });
      } catch (err) {
        failures += 1;
        results.push({ url, status: 'error', error: err instanceof CaptureError ? err.message : 'capture failed' });
        continue;
      }
      let extracted: Record<string, unknown> | undefined;
      if (schema !== undefined) {
        extracted = await modelExtract(captured.html, schema, {
          baseUrl: config.modelApiBaseUrl,
          apiKey: config.modelApiKey,
          model: config.modelName,
        });
      }
      const data: ExtractedContent =
        extracted === undefined ? { ...captured.structure } : { ...captured.structure, extracted };
      results.push({ url, status: 'ok', data });
    }
    if (failures === urls.length) {
      throw new HttpError(502, 'extract_failed', 'all urls failed to extract');
    }
    const payer = x402Payer(req) ?? 'unknown';
    revenue.record({
      endpoint: 'extract',
      payer,
      revenueUsdcUnits: config.x402ExtractPriceUsdcUnits,
      costUsdcUnits: config.computeCostUsdcUnitsPerRequest * urls.length,
    });
    return {
      results,
      payment: { payer, priceUsdcUnits: config.x402ExtractPriceUsdcUnits },
    };
  });

  app.get('/v1/extract/preview', async (req) => {
    const rawUrl = isRecord(req.query) ? req.query.url : undefined;
    if (typeof rawUrl !== 'string') throw unprocessable('url query parameter is required');
    const forwarded = req.headers['x-forwarded-for'];
    const firstForwarded = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined;
    const clientKey = firstForwarded !== undefined && firstForwarded !== '' ? firstForwarded : req.ip;
    if (!previewLimiter.allow(clientKey)) {
      throw new HttpError(429, 'rate_limited', 'preview rate limit exceeded; use the paid extract endpoint');
    }
    let structure;
    try {
      ({ structure } = await deps.captureStructured({ url: validatedUrl(rawUrl, allowHosts), options: { includeHtml: false } }));
    } catch (err) {
      if (err instanceof CaptureError) throw new HttpError(502, 'capture_failed', err.message);
      throw err;
    }
    return {
      url: rawUrl,
      preview: {
        title: structure.title,
        description: structure.description,
        headings: structure.headings.slice(0, 5),
        links: structure.links.slice(0, 10),
        wordCount: structure.wordCount,
        markdown: structure.markdown.slice(0, 1500),
      },
      truncated: true,
      upgrade: {
        endpoint: 'POST /v1/x402/extract',
        note: 'paid: full paragraphs + images + batch (up to 10 URLs) + optional model extraction',
      },
    };
  });

  app.get('/v1/ledger', async (req) => {
    const { account } = authenticate(req, db);
    if (account.address.toLowerCase() !== config.merchantAddress.toLowerCase()) {
      throw new HttpError(403, 'forbidden', 'ledger is merchant-only');
    }
    return { summary: revenue.summary(), recent: revenue.recent(50) };
  });

  app.get('/v1/x402/service', async () => {
    if (config.x402Network === undefined) {
      throw new HttpError(503, 'x402_disabled', 'x402 payment requires WEBCAP_CHAIN=base-sepolia or base');
    }
    return {
      service: 'webcap',
      description: 'Capture any URL as PNG/JPEG/PDF (+ free OG metadata), paid per-request in USDC via x402 (HTTP 402).',
      paymentProtocol: 'x402',
      x402Version: 2,
      paidEndpoints: [
        {
          method: 'POST',
          path: '/v1/x402/capture',
          body: { url: 'string (required)', format: 'png|jpeg|pdf (optional)' },
          priceUsdc: config.x402PriceUsdcUnits / USDC_SCALE,
          atomicUnits: String(config.x402PriceUsdcUnits),
          note: 'screenshot artifact (base64) + free OG metadata',
        },
        {
          method: 'POST',
          path: '/v1/x402/extract',
          body: {
            url: 'string (required, or urls: string[] up to 10 for a batch)',
            schema: 'string (optional) — natural-language description of the JSON to extract; uses a model when one is configured',
          },
          priceUsdc: config.x402ExtractPriceUsdcUnits / USDC_SCALE,
          atomicUnits: String(config.x402ExtractPriceUsdcUnits),
          note: 'structured content (title, headings, paragraphs, links, images) as JSON; one payment covers a batch',
        },
      ],
      price: {
        asset: config.x402Asset,
        network: config.x402Network,
        payTo: config.x402PayTo,
        scheme: 'exact',
      },
      howToPay:
        'POST /v1/x402/capture or /v1/x402/extract unpaid -> HTTP 402 with a base64 x402 v2 challenge (payment-required header) -> sign a gasless EIP-3009 transferWithAuthorization (from=your wallet, to=price.payTo, value=price.atomicUnits) -> retry with the PAYMENT-SIGNATURE header. The facilitator verifies + settles on-chain; USDC lands in the merchant wallet and the result is returned. Works with any x402 v2 client (@x402/axios) or scripts/x402-pay.ts (capture) / scripts/extract-pay.ts (extract). Free, no-payment preview: GET /v1/extract/preview?url=... (rate-limited).',
      facilitator: config.x402FacilitatorUrl,
      freeEndpoints: [
        { method: 'GET', path: '/v1/og?url=...', note: 'free OG metadata, no payment' },
        {
          method: 'GET',
          path: '/v1/extract/preview?url=...',
          note: 'free bounded structured preview (rate-limited); the paid extract returns full text + images + batch + model',
        },
        { method: 'GET', path: '/v1/health', note: 'liveness + chain' },
      ],
    };
  });

  app.get('/v1/og', async (req) => {
    const rawUrl = isRecord(req.query) ? req.query.url : undefined;
    if (typeof rawUrl !== 'string') throw unprocessable('url query parameter is required');
    try {
      return await deps.og({ url: validatedUrl(rawUrl, allowHosts) });
    } catch (err) {
      if (err instanceof CaptureError) throw new HttpError(502, 'capture_failed', err.message);
      throw err;
    }
  });

  app.get('/v1/account', async (req) => {
    const { account } = authenticate(req, db);
    return {
      address: account.address,
      balance: account.credits,
      invoices: invoices.listByAccount(account.id).map((inv) => ({
        id: String(inv.id),
        status: inv.status,
        credits: inv.usdc_amount / USDC_UNITS_PER_CREDIT,
        requiredUsdc: inv.usdc_amount / USDC_SCALE,
        createdAt: inv.created_at,
      })),
    };
  });
}

// Lazy + cached: loading at module import time would crash app boot (and the
// test suite) when public/icon.png is absent.
let iconPng: Buffer | undefined;

function loadIconPng(): Buffer | undefined {
  if (iconPng === undefined) {
    try {
      iconPng = readFileSync(new URL('../../public/icon.png', import.meta.url));
    } catch {
      return undefined;
    }
  }
  return iconPng;
}

/** Public paths advertised in the sitemap (the stable service surface). */
const SITEMAP_PATHS = [
  '/',
  '/openapi.json',
  '/icon.png',
  '/v1/x402/service',
  '/v1/x402/capture',
  '/v1/x402/extract',
  '/v1/x402/watches/topup',
  '/v1/watches',
  '/v1/extract/preview',
] as const;

/** XML-escape a value before embedding it in the sitemap (fixed list, stay correct). */
function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** The sitemap must be protocol-absolute https, even for an http:// dev base URL. */
function httpsBase(base: string): string {
  return base.startsWith('http://') ? `https://${base.slice('http://'.length)}` : base;
}

/** Build the sitemap.xml payload: one <url> per public path, https-absolute. */
function sitemapXml(config: WebcapConfig): string {
  const base = httpsBase(config.publicBaseUrl);
  const entries = SITEMAP_PATHS.map(
    (path) => `  <url>\n    <loc>${xmlEscape(`${base}${path}`)}</loc>\n  </url>`,
  ).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entries,
    '</urlset>',
    '',
  ].join('\n');
}

/** x402 machine-discovery catalog: what to call, what it costs, how to pay. */
function x402WellKnown(config: WebcapConfig) {
  const base = httpsBase(config.publicBaseUrl);
  return {
    service: 'webcap',
    description:
      'Pay-per-call web capture on Base mainnet: one-time screenshots (PNG/JPEG/PDF + free Open Graph metadata), structured content extraction, and scheduled monitoring with change-detection webhooks. All paid routes settle gasless USDC via x402 (HTTP 402).',
    network: config.x402Network ?? null,
    asset: config.x402Network === undefined ? null : config.x402Asset,
    payTo: config.x402Network === undefined ? null : config.x402PayTo,
    facilitator: config.x402FacilitatorUrl,
    endpoints: [
      {
        path: 'POST /v1/x402/capture',
        usdc: config.x402PriceUsdcUnits / USDC_SCALE,
        description: 'Screenshot any URL (PNG/JPEG/PDF) + free Open Graph metadata',
      },
      {
        path: 'POST /v1/x402/extract',
        usdc: config.x402ExtractPriceUsdcUnits / USDC_SCALE,
        description:
          'Structured extraction (title, headings, paragraphs, links, images, document-order markdown); batch up to 10 URLs per payment',
      },
      {
        path: 'POST /v1/x402/watches/topup',
        usdc:
          watchTopUpPriceUsdcUnits('capture', config) / USDC_SCALE,
        usdcMax: watchTopUpPriceUsdcUnits('extract', config) / USDC_SCALE,
        description: `Pre-pay ${WATCH_TOPUP_RUNS} scheduled monitor runs (capture-pack price shown; extract-pack is usdcMax; exact price quoted per watch via ?watchId=)`,
      },
    ],
    free: [
      { path: 'GET /v1/extract/preview?url=...', note: 'bounded structured preview (rate-limited)' },
      { path: 'GET /v1/og?url=...', note: 'Open Graph metadata' },
      { path: 'GET /v1/health', note: 'liveness + chain' },
    ],
    openapi: `${base}/openapi.json`,
    sitemap: `${base}/sitemap.xml`,
  };
}

/** A2A-style agent card with an x402/AP2 payments section, for agent-card consumers. */
function agentCard(config: WebcapConfig) {
  const base = httpsBase(config.publicBaseUrl);
  return {
    protocolVersion: '0.3.0',
    name: 'webcap',
    description: x402WellKnown(config).description,
    url: base,
    icon: `${base}/icon.png`,
    version: '1.0.0',
    roles: ['merchant'],
    capabilities: { streaming: false, pushNotifications: true },
    authentication: { schemes: ['x402'] },
    payments: {
      provider: 'x402',
      network: config.x402Network ?? null,
      asset: config.x402Network === undefined ? null : config.x402Asset,
      payTo: config.x402Network === undefined ? null : config.x402PayTo,
      facilitator: config.x402FacilitatorUrl,
    },
    skills: [
      {
        id: 'capture',
        name: 'Web capture',
        description: `Screenshot any URL as PNG/JPEG/PDF + free OG metadata — ${config.x402PriceUsdcUnits / USDC_SCALE} USDC via x402`,
        tags: ['screenshot', 'capture', 'x402', 'usdc'],
      },
      {
        id: 'extract',
        name: 'Structured extraction',
        description: `Title, headings, paragraphs, links, images, document-order markdown; batch up to 10 URLs — ${config.x402ExtractPriceUsdcUnits / USDC_SCALE} USDC via x402`,
        tags: ['scraping', 'extraction', 'markdown', 'x402', 'usdc'],
      },
      {
        id: 'watch',
        name: 'Scheduled monitoring',
        description: `Pre-pay ${WATCH_TOPUP_RUNS} runs of a capture/extract monitor with change-detection webhooks — ${watchTopUpPriceUsdcUnits('capture', config) / USDC_SCALE}–${watchTopUpPriceUsdcUnits('extract', config) / USDC_SCALE} USDC per pack via x402`,
        tags: ['monitoring', 'diff', 'webhook', 'x402', 'usdc'],
      },
    ],
  };
}

/** The JSON front-door payload, unchanged byte-for-byte for pure-JSON clients. */
function frontDoorPayload(config: WebcapConfig) {
  return {
    service: 'webcap',
    tagline:
      'Capture any URL as a screenshot, or extract its structured content + clean document-order markdown — paid per-request in USDC over x402 (HTTP 402).',
    endpoints: {
      free: [
        { path: 'GET /v1/extract/preview?url=...', note: 'bounded structured preview (rate-limited)' },
        { path: 'GET /v1/og?url=...', note: 'OG metadata' },
        { path: 'GET /v1/health', note: 'liveness + chain' },
      ],
      paid: [
        { path: 'POST /v1/x402/capture', usdc: config.x402PriceUsdcUnits / USDC_SCALE, note: 'PNG/JPEG/PDF screenshot + free OG' },
        { path: 'POST /v1/x402/extract', usdc: config.x402ExtractPriceUsdcUnits / USDC_SCALE, note: 'structured JSON; batch up to 10 URLs for one payment' },
      ],
    },
    catalog: 'GET /v1/x402/service — full agent-discoverable descriptor + the exact x402 payment flow',
    agentGuide: 'AGENT.md — how an AI agent discovers + pays (gasless EIP-3009, no ETH)',
    payment:
      config.x402Network === undefined
        ? 'x402 disabled (WEBCAP_CHAIN=local)'
        : `x402 v2 on ${config.x402Network}, asset ${config.x402Asset}, payTo ${config.x402PayTo}`,
  };
}

/** Join a possibly multi-valued Accept header; undefined when absent. */
function acceptOf(accept: string | string[] | undefined): string | undefined {
  if (accept === undefined) return undefined;
  return Array.isArray(accept) ? accept.join(',') : accept;
}

/** True when the client explicitly asks for JSON and does not accept HTML. */
function wantsJsonOnly(accept: string | undefined): boolean {
  if (accept === undefined || accept.trim() === '') return false;
  let json = false;
  let html = false;
  for (const part of accept.split(',')) {
    const segments = part.split(';');
    const mediaType = (segments[0] ?? '').trim().toLowerCase();
    if (mediaType === '') continue;
    let q = 1;
    for (const param of segments.slice(1)) {
      const kv = param.trim().split('=');
      if ((kv[0] ?? '').toLowerCase() === 'q' && kv[1] !== undefined) q = Number.parseFloat(kv[1]);
    }
    if (!Number.isFinite(q) || q <= 0) continue;
    if (mediaType === 'application/json' || mediaType === 'application/*' || mediaType === '*/*') json = true;
    if (mediaType === 'text/html' || mediaType === 'text/*' || mediaType === '*/*') html = true;
  }
  return json && !html;
}

function merchantAddressOf(config: WebcapConfig): string {
  if (config.merchantPrivateKey === '') return ZeroAddress;
  return new Wallet(config.merchantPrivateKey).address;
}

function createInvoice(
  invoices: ReturnType<typeof makeInvoicesRepo>,
  config: WebcapConfig,
  merchantAddress: string,
  accountId: number,
  creditsAmount: number,
): InvoiceRow {
  const id = invoices.create({
    account_id: accountId,
    pack: packForCredits(creditsAmount),
    chain: config.chain.name,
    usdc_contract: config.chain.usdcContract,
    usdc_address: merchantAddress,
    amount_usd: usdcForCredits(creditsAmount),
    usdc_amount: usdcUnitsForCredits(creditsAmount),
    recipient: merchantAddress,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  });
  const row = invoices.get(id);
  if (row === undefined) throw new Error(`invoice ${id} vanished after insert`);
  return row;
}

function packForCredits(creditsAmount: number): string {
  for (const [name, pack] of Object.entries(PACKS)) {
    if (pack.credits === creditsAmount) return name;
  }
  return 'custom';
}

function parseCredits(body: unknown): number {
  const raw = isRecord(body) ? body.credits : undefined;
  if (raw === undefined) return 100;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
    throw unprocessable('credits must be a positive integer');
  }
  return raw;
}


