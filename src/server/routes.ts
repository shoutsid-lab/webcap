/**
 * The capture/extract core routes: the x402 paid capture + extract, the free
 * rate-limited extract preview, the agent-discoverable x402 service
 * descriptor, and the free OG metadata endpoint. The credits-rail (API-key
 * account) routes live in ./billing.ts, the discovery routes in
 * ./discovery.ts, and the monitoring routes in ./watches.ts.
 */
import { createHash } from 'node:crypto';
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
import { recordHit } from '../db/hits.js';
import { CaptureError } from '../capture/errors.js';
import { previewFallback } from '../capture/preview-fallback.js';
import { HttpError, unprocessable } from '../util/errors.js';
import { RateLimiter, rejectRateLimited } from '../util/ratelimit.js';
import { extractPage, storeArtifact } from '../extract/service.js';
import type { PageStructure } from '../capture/pipeline.js';
import { pinoServiceLogger } from '../util/logger.js';
import { parseExtractSchema, parseExtractUrls, assertSupportedSchema, assertTypedExtractValid, filterExtractedBySchema, parseExtractSpans, parseTypedSchema, type ExtractedContent, type ExtractResult } from './extract-parse.js';
import { isRecord, parseFormat, parseOptions, validatedUrl } from './capture-parse.js';
import { x402Payer } from './x402.js';
import { computeAudit } from '../audit/checks.js';
import type { AppDeps } from './server.js';
import type { OgResult } from '../capture/og.js';
import { ogDebuggerHtml } from './pages/og-debugger.js';
import { OpenAICompatibleVisionAdapter } from '../ml/vision/adapter.js';
import { validateImageSignature, type ClassificationResult } from '../ml/vision/contracts.js';

// Fixed 60s window for the preview per-peer budget; the preview limit itself
// is configurable (WEBCAP_PREVIEW_RATE_LIMIT, default DEFAULT_PREVIEW_RATE_LIMIT).
const RATE_LIMIT_WINDOW_MS = 60_000;

export function registerRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, config } = deps;
  const revenue = makeRevenueRepo(db);
  const allowHosts = deps.captureAllowHosts;
  const previewLimiter = new RateLimiter(config.previewRateLimit ?? DEFAULT_PREVIEW_RATE_LIMIT, RATE_LIMIT_WINDOW_MS);
  // The debugger page fetches on the visitor's behalf, so it gets the same
  // fixed-window per-peer budget family as the preview route (separate
  // instance so the two free surfaces don't share one budget).
  const ogDebuggerLimiter = new RateLimiter(config.previewRateLimit ?? DEFAULT_PREVIEW_RATE_LIMIT, RATE_LIMIT_WINDOW_MS);

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

    const payer = x402Payer(req) ?? 'unknown';
    const spendCap = config.spendCapUsdcUnits;
    if (spendCap !== undefined && revenue.spentByPayer(payer) >= spendCap) {
      const spent = revenue.spentByPayer(payer);
      throw new HttpError(429, 'spend_cap_exceeded', 'per-payer spend cap exceeded', {
        payer,
        spent,
        cap: spendCap,
        reason: `per-payer spend cap exceeded: spent ${spent} of ${spendCap} USDC units`,
      });
    }

    let result;
    try {
      result = await deps.capture({ url: normalized, format, options });
    } catch (err) {
      if (err instanceof CaptureError) throw new HttpError(502, 'capture_failed', err.message);
      throw err;
    }
    (req as unknown as { _pendingRevenue?: { endpoint: string; payer: string; revenueUsdcUnits: number; costUsdcUnits: number } })._pendingRevenue = {
      endpoint: 'capture',
      payer,
      revenueUsdcUnits: config.x402PriceUsdcUnits,
      costUsdcUnits: config.computeCostUsdcUnitsPerRequest,
    };
    const url = storeArtifact(deps.artifacts, config, normalized, result);
    return {
      artifact: { format: result.format, bytes: result.bytes, data: result.buffer.toString('base64'), url },
      payment: {
        payer,
        priceUsdcUnits: config.x402PriceUsdcUnits,
        costUsdcUnits: config.computeCostUsdcUnitsPerRequest,
      },
    };
  });

  app.post('/v1/x402/extract', async (req) => {
    if (config.x402Network === undefined) {
      throw new HttpError(503, 'x402_disabled', 'x402 payment requires WEBCAP_CHAIN=base-sepolia or base');
    }
    const urls = parseExtractUrls(req.body, allowHosts);
    const typedSchema = parseTypedSchema(req.body);
    if (typedSchema !== undefined) {
      assertSupportedSchema(typedSchema);
      const spans = parseExtractSpans(req.body);
      const captureOptions = parseOptions(req.body);
      const results: ExtractResult[] = [];
      let failures = 0;
      for (const url of urls) {
        let captured;
        try {
          captured = await deps.captureStructured({
            url,
            options: { ...captureOptions, includeHtml: false },
          });
        } catch (err) {
          failures += 1;
          results.push({ url, status: 'error', error: err instanceof CaptureError ? err.message : 'capture failed' });
          continue;
        }
        const extracted = filterExtractedBySchema(captured.structure, typedSchema);
        assertTypedExtractValid(extracted, typedSchema, spans, [captured.structure.markdown]);
        results.push({ url, status: 'ok', data: { ...captured.structure, extracted } });
      }
      if (failures === urls.length) {
        throw new HttpError(502, 'extract_failed', 'all urls failed to extract');
      }
      const payer = x402Payer(req) ?? 'unknown';
      (req as unknown as { _pendingRevenue?: { endpoint: string; payer: string; revenueUsdcUnits: number; costUsdcUnits: number } })._pendingRevenue = {
        endpoint: 'extract',
        payer,
        revenueUsdcUnits: config.x402ExtractPriceUsdcUnits,
        costUsdcUnits: config.computeCostUsdcUnitsPerRequest * urls.length,
      };
      return {
        results,
        payment: {
          payer,
          priceUsdcUnits: config.x402ExtractPriceUsdcUnits,
          costUsdcUnits: config.computeCostUsdcUnitsPerRequest * urls.length,
        },
      };
    }
    const schema = parseExtractSchema(req.body);
    const captureOptions = parseOptions(req.body);
    const model = {
      baseUrl: config.modelApiBaseUrl,
      apiKey: config.modelApiKey,
      model: config.modelName,
    };
    const results: ExtractResult[] = [];
    let failures = 0;
    for (const url of urls) {
      let data: ExtractedContent;
      let modelUsed = false;
      try {
        data = await extractPage({
          url,
          captureStructured: deps.captureStructured,
          schema,
          model,
          modelTimeoutMs: config.modelTimeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS,
          logger: pinoServiceLogger(req.log),
          ...(captureOptions !== undefined ? { captureOptions } : {}),
        });
        modelUsed = true;
      } catch (err) {
        // Model extraction failed - fall back to deterministic extraction
        // using extractPage with model disabled (schema provided but no model).
        try {
          data = await extractPage({
            url,
            captureStructured: deps.captureStructured,
            schema,
            model: { baseUrl: '', apiKey: '', model: '' }, // disable model
            modelTimeoutMs: 0,
            logger: pinoServiceLogger(req.log),
            ...(captureOptions !== undefined ? { captureOptions } : {}),
          });
          modelUsed = false;
        } catch (fallbackErr) {
          failures += 1;
          results.push({ url, status: 'error', error: fallbackErr instanceof CaptureError ? fallbackErr.message : 'capture failed' });
          continue;
        }
      }
      // Attach model usage info if model was used for this URL
      if (modelUsed && 'extracted' in data && data.extracted !== undefined) {
        // The extractPage return type includes extracted data when model was used;
        // model usage details are available via the internal __usage__ marker
        // but are not propagated to the public ExtractedContent shape in the batch path.
      }
      results.push({ url, status: 'ok', data });
    }
    if (failures === urls.length) {
      throw new HttpError(502, 'extract_failed', 'all urls failed to extract');
    }
    const payer = x402Payer(req) ?? 'unknown';
    // MARGIN TRADEOFF (batch 10 -> 50): the extract price stays FLAT at 10000
    // units ($0.01) while the compute cost scales as 200 x N, so a full
    // batch-50 nets exactly zero and the per-URL revenue floor
    // (10000 / 50 = 200 units = $0.0002) EQUALS one unit of compute cost.
    // That floor is the loss boundary: any per-URL cost above 200 units loses
    // money on full batches, which is why the batch cap stops at 50. The
    // T3-S3d e2e test pins this invariant against the revenue ledger.
    (req as unknown as { _pendingRevenue?: { endpoint: string; payer: string; revenueUsdcUnits: number; costUsdcUnits: number } })._pendingRevenue = {
      endpoint: 'extract',
      payer,
      revenueUsdcUnits: config.x402ExtractPriceUsdcUnits,
      costUsdcUnits: config.computeCostUsdcUnitsPerRequest * urls.length,
    };
    return {
      results,
      payment: {
        payer,
        priceUsdcUnits: config.x402ExtractPriceUsdcUnits,
        costUsdcUnits: config.computeCostUsdcUnitsPerRequest * urls.length,
      },
    };
  });

  app.post('/v1/x402/audit', async (req) => {
    if (config.x402Network === undefined) {
      throw new HttpError(503, 'x402_disabled', 'x402 payment requires WEBCAP_CHAIN=base-sepolia or base');
    }
    const body = req.body;
    const rawUrl = isRecord(body) ? body.url : undefined;
    if (typeof rawUrl !== 'string') throw unprocessable('url is required');
    const url = validatedUrl(rawUrl, allowHosts);
    let captured;
    try {
      captured = await deps.captureStructured({ url, options: { includeHtml: true } });
    } catch (err) {
      if (err instanceof CaptureError) throw new HttpError(502, 'audit_failed', err.message);
      throw err;
    }
    const checks = computeAudit({ structure: captured.structure, html: captured.html, pageUrl: url });
    const payer = x402Payer(req) ?? 'unknown';
    (req as unknown as { _pendingRevenue?: { endpoint: string; payer: string; revenueUsdcUnits: number; costUsdcUnits: number } })._pendingRevenue = {
      endpoint: 'audit',
      payer,
      revenueUsdcUnits: config.x402AuditPriceUsdcUnits,
      costUsdcUnits: config.computeCostUsdcUnitsPerRequest,
    };
    return {
      audit: { url, ...checks },
      payment: {
        payer,
        priceUsdcUnits: config.x402AuditPriceUsdcUnits,
        costUsdcUnits: config.computeCostUsdcUnitsPerRequest,
      },
    };
  });

  app.get('/v1/extract/preview', async (req, reply) => {
    const rawUrl = isRecord(req.query) ? req.query.url : undefined;
    if (typeof rawUrl !== 'string') throw unprocessable('url query parameter is required');
    // Validate URL once up front so both the primary path and fallback share it.
    const normalizedUrl = validatedUrl(rawUrl, allowHosts);
    // Key on the actual peer IP only: behind the ngrok tunnel req.ip is the
    // tunnel peer, while X-Forwarded-For is attacker-controlled (spoofing it
    // previously minted an unlimited free-capture budget per header value).
    if (!previewLimiter.allow(req.ip)) {
      rejectRateLimited(reply, previewLimiter, req.ip, 'preview rate limit exceeded; use the paid extract endpoint', {
        paidUpgrade: {
          endpoint: 'POST /v1/x402/extract',
          priceUsdc: config.x402ExtractPriceUsdcUnits / USDC_SCALE,
          priceUsdcUnits: config.x402ExtractPriceUsdcUnits,
          howToPay: 'HTTP 402 -> sign a gasless EIP-3009 USDC transferWithAuthorization -> retry with the PAYMENT-SIGNATURE header (x402 v2 exact scheme)',
          guide: `${config.publicBaseUrl}/skill.md`,
        },
      });
    }
    let enhanced = false;
    let modelUsage: { prompt: number; completion: number; total: number } | undefined;
    let structure: {
      title: string;
      description: string;
      headings: { level: number; text: string }[];
      paragraphs: string[];
      links: { href: string; text: string }[];
      images: { src: string; alt: string }[];
      wordCount: number;
      markdown: string;
    };
    try {
      // If model extraction is configured (MODEL_API_BASE_URL, MODEL_API_KEY, MODEL_NAME set),
      // use it to enrich the preview with AI-extracted fields.
      if (config.modelApiBaseUrl !== '' && config.modelApiKey !== '' && config.modelName !== '') {
        const model = {
          baseUrl: config.modelApiBaseUrl,
          apiKey: config.modelApiKey,
          model: config.modelName,
        };
        const extractResult = await extractPage({
          url: normalizedUrl,
          captureStructured: deps.captureStructured,
          schema: undefined, // no structured schema for preview; model adds extracted on top
          model,
          modelTimeoutMs: 12_000, // 12s model response for preview — keeps total under 35s client budget
          logger: pinoServiceLogger(req.log),
          captureOptions: { timeoutMs: 12_000 }, // 12s browser + 2×10s fallback = 32s total, well under 35s client AbortController
        });
        // Build mutable structure from extractResult
        structure = {
          title: extractResult.title,
          description: extractResult.description,
          headings: [...extractResult.headings],
          paragraphs: [...extractResult.paragraphs],
          links: [...extractResult.links],
          images: [...extractResult.images],
          wordCount: extractResult.wordCount,
          markdown: extractResult.markdown,
        };
        // Check if model extraction returned extracted data
        if ('extracted' in extractResult && extractResult.extracted !== undefined) {
          enhanced = true;
          const extracted = extractResult.extracted;
          // Remove __usage__ if present (internal marker, not part of public API)
          const { __usage__, ...extractedData } = extracted;
          modelUsage = extractedData.__usage__ as
            | { prompt: number; completion: number; total: number }
            | undefined;
          // Merge extracted fields into structure, preserving deterministic values
          if (extracted.title && !structure.title) structure.title = extracted.title as string;
          if (extracted.description && !structure.description) structure.description = extracted.description as string;
          // Add extracted headings (up to limit), avoiding duplicates
          if (extracted.headings && Array.isArray(extracted.headings)) {
            const mergedHeadings: typeof structure.headings = structure.headings;
            for (const h of extracted.headings) {
              const exists = mergedHeadings.find((eh: { level: number; text: string }) => eh.text === h.text);
              if (!exists) mergedHeadings.push(h);
            }
            structure.headings = mergedHeadings.slice(0, config.previewHeadingsLimit ?? DEFAULT_PREVIEW_HEADINGS_LIMIT);
          }
          // Add extracted links (up to limit), avoiding duplicates
          if (extracted.links && Array.isArray(extracted.links)) {
            const mergedLinks: typeof structure.links = structure.links;
            for (const l of extracted.links) {
              const exists = mergedLinks.find((el: { href: string; text: string }) => el.href === l.href && el.text === l.text);
              if (!exists) mergedLinks.push(l);
            }
            structure.links = mergedLinks.slice(0, config.previewLinksLimit ?? DEFAULT_PREVIEW_LINKS_LIMIT);
          }
        }
      } else {
        const captured = await deps.captureStructured({ url: normalizedUrl, options: { timeoutMs: 12_000, includeHtml: false } });
        structure = {
          title: captured.structure.title,
          description: captured.structure.description,
          headings: [...captured.structure.headings],
          paragraphs: [...captured.structure.paragraphs],
          links: [...captured.structure.links],
          images: [...captured.structure.images],
          wordCount: captured.structure.wordCount,
          markdown: captured.structure.markdown,
        };
      }
    } catch (err) {
      // Browser capture failed — try the lightweight HTTP-only fallback
      // instead of immediately returning a 502. This gives a degraded but
      // functional result for pages that don't need JS rendering.
      try {
        const fallback = await previewFallback(normalizedUrl);
        structure = {
          title: fallback.title,
          description: fallback.description,
          headings: [...fallback.headings],
          paragraphs: [...fallback.paragraphs],
          links: [...fallback.links],
          images: [...fallback.images],
          wordCount: fallback.wordCount,
          markdown: fallback.markdown,
        };
      } catch (fallbackErr) {
        // Both browser and fallback failed — return the best error we have
        if (err instanceof CaptureError) throw new HttpError(502, 'capture_failed', err.message);
        if (fallbackErr instanceof CaptureError) throw new HttpError(502, 'capture_failed', fallbackErr.message);
        throw new HttpError(502, 'capture_failed', `capture failed for ${rawUrl}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // ML Classification: when model is configured, classify the page type
    let classification: ClassificationResult | undefined;
    if (config.modelApiBaseUrl !== '' && config.modelApiKey !== '' && config.modelName !== '') {
      try {
        const adapter = new OpenAICompatibleVisionAdapter({
          baseUrl: config.modelApiBaseUrl,
          model: config.modelName,
          apiKey: config.modelApiKey,
          timeoutMs: 15_000,
          allowRemoteEndpoint: true,
        });
        // Capture screenshot for classification
        const captureResult = await deps.capture({ url: normalizedUrl, format: 'jpeg' });
        if (validateImageSignature(captureResult.buffer, 'image/jpeg')) {
          const exchange = await adapter.analyze({
            imageBytes: captureResult.buffer,
            mediaType: 'image/jpeg',
            task: 'classification',
          });
          classification = exchange.result as ClassificationResult;
        }
      } catch {
        // Classification is best-effort; don't fail the preview
      }
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
        ...(enhanced ? { enhanced: true, modelUsage } : {}),
        ...(classification !== undefined ? { classification } : {}),
      },
      truncated: true,
      upgrade: {
        endpoint: 'POST /v1/x402/extract',
        note: 'paid: full paragraphs + images + batch (up to 50 URLs) + optional model extraction + AI classification',
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

  /**
   * GET /v1/demo — returns a sample full extract response so users can see
   * the actual output format before paying. No auth, no rate limit.
   */
  app.get('/v1/demo', async () => {
    return {
      url: 'https://news.ycombinator.com/',
      results: [
        {
          url: 'https://news.ycombinator.com/',
          title: 'Hacker News',
          description: 'Hacker News is a social news website focusing on computer science and entrepreneurship. It is run by Y Combinator.',
          headings: [
            { level: 1, text: 'Hacker News' },
            { level: 2, text: 'New | Past | Comments | Ask | Show | Jobs | Submit' },
            { level: 3, text: 'Sitewide Links' },
          ],
          paragraphs: [
            'Welcome to Hacker News. This is a demo of the full extract output \u2014 showing what you get when you pay $0.01 for a complete structured extraction.',
            'The free preview gives you titles, a few headings, and truncated markdown. The full extract gives you EVERYTHING: all paragraphs, all links with text, all images, full markdown, and optional AI classification.',
            'Compare this to the free preview. Notice how much more data you get \u2014 complete text content, every navigation link, word count, and structured classification.',
            'This is perfect for content monitoring, competitive analysis, SEO audits, research automation, and building data pipelines. All from a single API call.',
          ],
          links: [
            { href: 'https://news.ycombinator.com/newest', text: 'new' },
            { href: 'https://news.ycombinator.com/front', text: 'past' },
            { href: 'https://news.ycombinator.com/newcomments', text: 'comments' },
            { href: 'https://news.ycombinator.com/ask', text: 'ask' },
            { href: 'https://news.ycombinator.com/show', text: 'show' },
            { href: 'https://news.ycombinator.com/jobs', text: 'jobs' },
            { href: 'https://news.ycombinator.com/submit', text: 'submit' },
            { href: 'https://www.ycombinator.com/apply/', text: 'Y Combinator' },
            { href: 'https://www.ycombinator.com/legal/', text: 'Legal' },
            { href: 'https://www.ycombinator.com/faq/', text: 'FAQ' },
          ],
          images: [
            { src: 'https://news.ycombinator.com/y18.svg', alt: 'Hacker News logo' },
          ],
          wordCount: 2847,
          markdown: '# Hacker News\n\n## New | Past | Comments | Ask | Show | Jobs | Submit\n\n1. **Show HN: I built a tool that extracts structured data from any URL** (github.com/example)\n   - 42 points | 28 comments | 3 hours ago\n\n2. **The Rise of Web APIs in 2026** (techcrunch.com)\n   - 187 points | 142 comments | 5 hours ago\n\n3. **Ask HN: What tools do you use for web scraping?** (news.ycombinator.com)\n   - 89 points | 67 comments | 2 hours ago\n\n---\n\n## Complete Text Content\n\nWelcome to Hacker News, a community-focused platform where developers and entrepreneurs discuss technology, startups, and computer science. Every submission is voted on by the community, with the most interesting content rising to the top.\n\nThe site features discussions about software development, computer science, technology, and entrepreneurship. Popular topics include programming languages, open source projects, startups, funding, and emerging technologies.\n\nHacker News has been a cornerstone of the tech community since its launch, serving as a primary discovery channel for new tools, libraries, and services.',
          classification: { type: 'news_aggregator', confidence: 0.97 },
        },
      ],
      _demo: true,
      _note: 'Sample full extract for Hacker News. The free preview would only show: title, 1 heading, 1 link, and ~200 chars of truncated markdown.',
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
          body: {
            url: 'string (required)',
            format: 'png|jpeg|pdf (optional)',
            options: 'object (optional) — render tuning: viewport, deviceScaleFactor, isMobile, userAgent, proxy, waitFor, actions',
          },
          priceUsdc: config.x402PriceUsdcUnits / USDC_SCALE,
          atomicUnits: String(config.x402PriceUsdcUnits),
          note: 'screenshot artifact (base64) + free OG metadata',
        },
        {
          method: 'POST',
          path: '/v1/x402/extract',
          body: {
            url: 'string (required, or urls: string[] up to 50 for a batch)',
            schema: 'string (optional) — natural-language description of the JSON to extract; uses a model when one is configured',
            options: 'object (optional) — capture tuning per URL: proxy, waitFor, actions, viewport, timeoutMs, fullPage',
          },
          priceUsdc: config.x402ExtractPriceUsdcUnits / USDC_SCALE,
          atomicUnits: String(config.x402ExtractPriceUsdcUnits),
          note: 'structured content (title, headings, paragraphs, links, images) as JSON; one payment covers a batch',
        },
        {
          method: 'POST',
          path: '/v1/x402/audit',
          body: { url: 'string (required)' },
          priceUsdc: config.x402AuditPriceUsdcUnits / USDC_SCALE,
          atomicUnits: String(config.x402AuditPriceUsdcUnits),
          note: 'SEO basics + link/OG health in one call',
        },
        {
          method: 'POST',
          path: '/v1/x402/map-lite',
          body: {
            url: 'string (required)',
            maxUrls: 'integer (optional, default 20, at most 50) — maximum URLs to return',
          },
          priceUsdc: config.x402AuditPriceUsdcUnits / USDC_SCALE,
          atomicUnits: String(config.x402AuditPriceUsdcUnits),
          note: 'site URL list via sitemap/robots plus a 1-hop same-host crawl in one call',
        },
        {
          method: 'POST',
          path: '/v1/x402/video',
          body: {
            url: 'string (required)',
            format: 'mp4|webm (optional, default mp4)',
            durationMs: 'integer (optional, default 5000, at most 30000) — recording duration in milliseconds',
            scrollSpeed: 'integer (optional, default 800, at most 5000) — pixels scrolled per choreography step',
            scrollEasing: 'linear|ease-in-out (optional, default linear)',
            options: 'object (optional) — viewport forwarded to the recording context',
          },
          priceUsdc: config.x402VideoPriceUsdcUnits / USDC_SCALE,
          atomicUnits: String(config.x402VideoPriceUsdcUnits),
          note: 'scroll-capture a URL as an MP4/WebM video in one call',
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
        'POST /v1/x402/capture, /v1/x402/extract, /v1/x402/audit, /v1/x402/map-lite, or /v1/x402/video unpaid -> HTTP 402 with a base64 x402 v2 challenge (payment-required header) -> sign a gasless EIP-3009 transferWithAuthorization (from=your wallet, to=price.payTo, value=price.atomicUnits) -> retry with the PAYMENT-SIGNATURE header. The facilitator verifies + settles on-chain; USDC lands in the merchant wallet and the result is returned. Works with any x402 v2 client (@x402/axios) or scripts/x402-pay.ts (capture) / scripts/extract-pay.ts (extract). Free, no-payment preview: GET /v1/extract/preview?url=... (rate-limited).',
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

  // Free OG debugger tool page (server-rendered GET form + results). Reuses
  // the exact deps.og service function as GET /v1/og — no new fetch pipeline.
  // Every outcome (empty form, gated notice, inline error, results) is 200
  // HTML; a bad URL is never a 500.
  app.get('/og-debugger', async (req, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8');
    const rawUrl = isRecord(req.query) ? req.query.url : undefined;
    if (rawUrl === undefined || rawUrl === '') {
      return reply.send(ogDebuggerHtml(config, { state: 'empty' }));
    }
    if (typeof rawUrl !== 'string') {
      return reply.send(ogDebuggerHtml(config, { state: 'error', rawUrl: '[invalid]', message: 'invalid url' }));
    }
    // Key on the actual peer IP only (same rationale as the preview limiter:
    // X-Forwarded-For is attacker-controlled behind tunnels).
    if (!ogDebuggerLimiter.allow(req.ip)) {
      return reply.send(ogDebuggerHtml(config, { state: 'rate_limited' }));
    }
    let normalized: string;
    try {
      normalized = validatedUrl(rawUrl, allowHosts);
    } catch (err) {
      const message = err instanceof HttpError ? err.message : 'invalid url';
      return reply.send(ogDebuggerHtml(config, { state: 'error', rawUrl, message }));
    }
    let result: OgResult;
    try {
      result = await deps.og({ url: normalized });
    } catch (err) {
      if (err instanceof CaptureError) {
        return reply.send(ogDebuggerHtml(config, { state: 'error', rawUrl, message: `upstream fetch failed (${err.message})` }));
      }
      throw err;
    }
    return reply.send(ogDebuggerHtml(config, { state: 'ok', rawUrl, result }));
  });

  /**
   * POST /v1/waitlist — email capture for the landing page.
   * Stores email addresses for the waitlist/mailing list.
   * Uses the tracking_events table with event='waitlist_signup'.
   */
  app.post('/v1/waitlist', async (req) => {
    const body = req.body;
    if (!isRecord(body)) throw unprocessable('body must be an object');
    const email = typeof body.email === 'string' ? body.email.trim() : undefined;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw unprocessable('valid email is required');

    // Store as a tracking event
    try {
      const referrer = typeof req.headers.referer === 'string' ? req.headers.referer : null;
      const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
      const ipHash = req.ip ? createHash('sha256').update(req.ip).digest('hex').slice(0, 16) : null;
      db.prepare(
        'INSERT INTO tracking_events (event, meta_json, referrer, user_agent, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('waitlist_signup', JSON.stringify({ email }), referrer, userAgent, ipHash, new Date().toISOString());
    } catch {
      // Non-fatal: tracking is best-effort
    }

    return { ok: true, message: 'Added to waitlist' };
  });

  /**
   * POST /v1/track — lightweight landing page event tracking.
   * Records page views, preview form submissions, and other conversion events.
   * No auth required; fire-and-forget from client-side JavaScript.
   * Stores granular event metadata in the tracking_events table for funnel analysis.
   *
   * Safety net: navigator.sendBeacon() sends strings as text/plain by default.
   * Register a text/plain parser that attempts JSON.parse so beacons that omit
   * the Blob wrapper still land correctly.
   */
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(new Error('invalid JSON in text/plain body'), undefined);
    }
  });
  app.post('/v1/track', async (req) => {
    const body = req.body;
    if (!isRecord(body)) throw unprocessable('body must be an object');
    const event = typeof body.event === 'string' ? body.event : undefined;
    if (!event) throw unprocessable('event is required');
    const metadata = typeof body.meta === 'object' && body.meta !== null ? body.meta : {};
    
    // Record as a special endpoint hit for analytics (backward compat)
    recordHit(db, {
      endpoint: `track:${event}`,
      status: 200,
      durationMs: 0,
    });

    // Store granular event data for funnel analysis
    try {
      const referrer = typeof req.headers.referer === 'string' ? req.headers.referer : null;
      const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
      const ipHash = req.ip ? createHash('sha256').update(req.ip).digest('hex').slice(0, 16) : null;
      db.prepare(
        'INSERT INTO tracking_events (event, meta_json, referrer, user_agent, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(event, JSON.stringify(metadata), referrer, userAgent, ipHash, new Date().toISOString());
    } catch {
      // Non-fatal: tracking metadata is best-effort
    }
    
    return { ok: true, event };
  });
}
