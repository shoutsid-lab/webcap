/**
 * The capture/extract core routes: the x402 paid capture + extract, the free
 * rate-limited extract preview, the agent-discoverable x402 service
 * descriptor, and the free OG metadata endpoint. The credits-rail (API-key
 * account) routes live in ./billing.ts, the discovery routes in
 * ./discovery.ts, and the monitoring routes in ./watches.ts.
 */
import type { FastifyInstance } from 'fastify';
import {
  DEFAULT_MODEL_TIMEOUT_MS,
  DEFAULT_PREVIEW_HEADINGS_LIMIT,
  DEFAULT_PREVIEW_LINKS_LIMIT,
  DEFAULT_PREVIEW_MARKDOWN_LIMIT,
  DEFAULT_PREVIEW_RATE_LIMIT,
  USDC_SCALE,
  WATCH_TOPUP_RUNS,
  watchTopUpPriceUsdcUnits,
} from '../config.js';
import { makeRevenueRepo } from '../db/revenue.js';
import { CaptureError } from '../capture/errors.js';
import { HttpError, unprocessable } from '../util/errors.js';
import { RateLimiter, rejectRateLimited } from '../util/ratelimit.js';
import { extractPage, storeArtifact } from '../extract/service.js';
import { pinoServiceLogger } from '../util/logger.js';
import { parseExtractSchema, parseExtractUrls, type ExtractedContent, type ExtractResult } from './extract-parse.js';
import { isRecord, parseFormat, parseOptions, validatedUrl } from './capture-parse.js';
import { x402Payer } from './x402.js';
import type { AppDeps } from './server.js';

// Fixed 60s window for the preview per-peer budget; the preview limit itself
// is configurable (WEBCAP_PREVIEW_RATE_LIMIT, default DEFAULT_PREVIEW_RATE_LIMIT).
const RATE_LIMIT_WINDOW_MS = 60_000;

export function registerRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, config } = deps;
  const revenue = makeRevenueRepo(db);
  const allowHosts = deps.captureAllowHosts;
  const previewLimiter = new RateLimiter(config.previewRateLimit ?? DEFAULT_PREVIEW_RATE_LIMIT, RATE_LIMIT_WINDOW_MS);

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
    const url = storeArtifact(deps.artifacts, config, normalized, result);
    return {
      artifact: { format: result.format, bytes: result.bytes, data: result.buffer.toString('base64'), url },
      payment: { payer, priceUsdcUnits: config.x402PriceUsdcUnits },
    };
  });

  app.post('/v1/x402/extract', async (req) => {
    if (config.x402Network === undefined) {
      throw new HttpError(503, 'x402_disabled', 'x402 payment requires WEBCAP_CHAIN=base-sepolia or base');
    }
    const urls = parseExtractUrls(req.body, allowHosts);
    const schema = parseExtractSchema(req.body);
    const model = {
      baseUrl: config.modelApiBaseUrl,
      apiKey: config.modelApiKey,
      model: config.modelName,
    };
    const results: ExtractResult[] = [];
    let failures = 0;
    for (const url of urls) {
      let data: ExtractedContent;
      try {
        data = await extractPage({
          url,
          captureStructured: deps.captureStructured,
          schema,
          model,
          modelTimeoutMs: config.modelTimeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS,
          logger: pinoServiceLogger(req.log),
        });
      } catch (err) {
        failures += 1;
        results.push({ url, status: 'error', error: err instanceof CaptureError ? err.message : 'capture failed' });
        continue;
      }
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

  app.get('/v1/extract/preview', async (req, reply) => {
    const rawUrl = isRecord(req.query) ? req.query.url : undefined;
    if (typeof rawUrl !== 'string') throw unprocessable('url query parameter is required');
    // Key on the actual peer IP only: behind the ngrok tunnel req.ip is the
    // tunnel peer, while X-Forwarded-For is attacker-controlled (spoofing it
    // previously minted an unlimited free-capture budget per header value).
    if (!previewLimiter.allow(req.ip)) {
      rejectRateLimited(reply, previewLimiter, req.ip, 'preview rate limit exceeded; use the paid extract endpoint');
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
        headings: structure.headings.slice(0, config.previewHeadingsLimit ?? DEFAULT_PREVIEW_HEADINGS_LIMIT),
        links: structure.links.slice(0, config.previewLinksLimit ?? DEFAULT_PREVIEW_LINKS_LIMIT),
        wordCount: structure.wordCount,
        markdown: structure.markdown.slice(0, config.previewMarkdownLimit ?? DEFAULT_PREVIEW_MARKDOWN_LIMIT),
      },
      truncated: true,
      upgrade: {
        endpoint: 'POST /v1/x402/extract',
        note: 'paid: full paragraphs + images + batch (up to 10 URLs) + optional model extraction',
      },
      paidUpgrade: {
        endpoint: 'POST /v1/x402/extract',
        priceUsdc: config.x402ExtractPriceUsdcUnits / USDC_SCALE,
        priceUsdcUnits: config.x402ExtractPriceUsdcUnits,
        howToPay: 'HTTP 402 -> sign a gasless EIP-3009 USDC transferWithAuthorization -> retry with the PAYMENT-SIGNATURE header (x402 v2 exact scheme)',
        guide: `${config.publicBaseUrl}/skill.md`,
      },
    };
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
        {
          method: 'POST',
          path: '/v1/x402/watches/topup',
          body: { watchId: 'string (required)', runs: `${WATCH_TOPUP_RUNS} (required; one pack)` },
          priceUsdc: watchTopUpPriceUsdcUnits('capture', config) / USDC_SCALE,
          atomicUnits: String(watchTopUpPriceUsdcUnits('capture', config)),
          usdcMax: watchTopUpPriceUsdcUnits('extract', config) / USDC_SCALE,
          note: `Pre-pay ${WATCH_TOPUP_RUNS} scheduled monitor runs of an existing watch (capture-pack price shown; extract-pack is usdcMax; exact price quoted per watch via ?watchId=)`,
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
}
