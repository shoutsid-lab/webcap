import type { FastifyInstance } from 'fastify';
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
  usdcForCredits,
  usdcUnitsForCredits,
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

  app.get('/', async () => ({
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
  }));

  app.get('/v1/health', async () => ({
    ok: true,
    chainId: config.chain.chainId,
    creditsPerUsdc: CREDITS_PER_USDC,
    pricePerCredit: PRICE_PER_CREDIT,
  }));

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


