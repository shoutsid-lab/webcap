/**
 * ML analysis routes for webcap.
 *
 * Provides visual analysis endpoints that leverage the ML intelligence layer.
 * These routes use the vision adapter for AI-powered page analysis.
 */
import type { FastifyInstance } from 'fastify';
import { makeRevenueRepo } from '../db/revenue.js';
import type { Db } from '../db/index.js';
import type { WebcapConfig } from '../config.js';
import { HttpError, unprocessable } from '../util/errors.js';
import { isRecord, validatedUrl } from './capture-parse.js';
import { x402Payer } from './x402.js';
import { OpenAICompatibleVisionAdapter, VisionError } from '../ml/vision/adapter.js';
import { validateTask, validateMediaType, type AnalysisTask, type MediaType } from '../ml/vision/contracts.js';
import type { AppDeps } from './server.js';

// --- Rate limiting for free analysis preview ---
const ANALYSIS_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_ANALYSIS_RATE_LIMIT = 5; // 5 free analyses per minute

// --- Analysis price (same as extract for now) ---
const DEFAULT_ANALYSIS_PRICE_USDC_UNITS = 10_000; // $0.01

export interface MLRouteDeps {
  readonly db: Db;
  readonly config: WebcapConfig;
  readonly captureAllowHosts?: readonly string[];
}

/**
 * Register ML analysis routes.
 */
export function registerMLRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, config } = deps;
  const revenue = makeRevenueRepo(db);
  const allowHosts = deps.captureAllowHosts;

  /**
   * POST /v1/x402/analyze
   *
   * AI-powered visual analysis of a web page screenshot.
   * Supports: classification, accessibility, layout, entities, sentiment
   *
   * Request body:
   *   { "url": "https://...", "task": "classification" }
   *
   * Optional:
   *   { "url": "...", "task": "accessibility", "context": "focus on forms" }
   */
  app.post('/v1/x402/analyze', async (req) => {
    if (config.x402Network === undefined) {
      throw new HttpError(503, 'x402_disabled', 'x402 payment requires WEBCAP_CHAIN=base-sepolia or base');
    }

    // Parse request
    const body = req.body;
    if (!isRecord(body)) throw unprocessable('body must be an object');

    const rawUrl = body.url;
    if (typeof rawUrl !== 'string') throw unprocessable('url is required');
    const url = validatedUrl(rawUrl, allowHosts);

    const rawTask = body.task;
    if (typeof rawTask !== 'string') throw unprocessable('task is required');
    const task = validateTask(rawTask);

    const context = typeof body.context === 'string' ? body.context : undefined;

    // Check model configuration
    if (config.modelApiBaseUrl === '' || config.modelApiKey === '' || config.modelName === '') {
      throw new HttpError(503, 'model_not_configured', 'ML analysis requires MODEL_API_BASE_URL, MODEL_API_KEY, and MODEL_NAME to be configured');
    }

    // Create vision adapter
    const adapter = new OpenAICompatibleVisionAdapter({
      baseUrl: config.modelApiBaseUrl,
      model: config.modelName,
      apiKey: config.modelApiKey,
      timeoutMs: config.modelTimeoutMs ?? 30_000,
      allowRemoteEndpoint: true, // Allow non-localhost for production models
    });

    // Capture screenshot
    let captureResult;
    try {
      captureResult = await deps.capture({ url, format: 'png' });
    } catch (err) {
      throw new HttpError(502, 'capture_failed', `failed to capture screenshot: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Perform analysis
    const started = performance.now();
    let exchange;
    try {
      exchange = await adapter.analyze({
        imageBytes: captureResult.buffer,
        mediaType: 'image/png',
        task,
        context,
      });
    } catch (err) {
      if (err instanceof VisionError) {
        throw new HttpError(502, 'analysis_failed', `ML analysis failed: ${err.message}`);
      }
      throw err;
    }
    const latencyMs = Math.max(0, performance.now() - started);

    // Record revenue
    const payer = x402Payer(req) ?? 'unknown';
    revenue.record({
      endpoint: 'analyze',
      payer,
      revenueUsdcUnits: DEFAULT_ANALYSIS_PRICE_USDC_UNITS,
      costUsdcUnits: config.computeCostUsdcUnitsPerRequest,
    });

    return {
      task,
      result: exchange.result,
      payment: {
        payer,
        priceUsdcUnits: DEFAULT_ANALYSIS_PRICE_USDC_UNITS,
        costUsdcUnits: config.computeCostUsdcUnitsPerRequest,
      },
      latency_ms: Math.round(latencyMs),
    };
  });

  /**
   * POST /v1/x402/analyze/batch
   *
   * Batch analysis: analyze multiple URLs with the same task.
   * One payment covers the entire batch.
   *
   * Request body:
   *   { "urls": ["https://...", "..."], "task": "classification" }
   */
  app.post('/v1/x402/analyze/batch', async (req) => {
    if (config.x402Network === undefined) {
      throw new HttpError(503, 'x402_disabled', 'x402 payment requires WEBCAP_CHAIN=base-sepolia or base');
    }

    // Parse request
    const body = req.body;
    if (!isRecord(body)) throw unprocessable('body must be an object');

    const rawUrls = body.urls;
    if (!Array.isArray(rawUrls) || rawUrls.length === 0) throw unprocessable('urls must be a non-empty array');
    if (rawUrls.length > 10) throw unprocessable('urls must contain at most 10 items');

    const rawTask = body.task;
    if (typeof rawTask !== 'string') throw unprocessable('task is required');
    const task = validateTask(rawTask);

    const context = typeof body.context === 'string' ? body.context : undefined;

    // Validate URLs
    const urls: string[] = [];
    for (const rawUrl of rawUrls) {
      if (typeof rawUrl !== 'string') throw unprocessable('each url must be a string');
      urls.push(validatedUrl(rawUrl, allowHosts));
    }

    // Check model configuration
    if (config.modelApiBaseUrl === '' || config.modelApiKey === '' || config.modelName === '') {
      throw new HttpError(503, 'model_not_configured', 'ML analysis requires MODEL_API_BASE_URL, MODEL_API_KEY, and MODEL_NAME to be configured');
    }

    // Create vision adapter
    const adapter = new OpenAICompatibleVisionAdapter({
      baseUrl: config.modelApiBaseUrl,
      model: config.modelName,
      apiKey: config.modelApiKey,
      timeoutMs: config.modelTimeoutMs ?? 30_000,
      allowRemoteEndpoint: true,
    });

    // Process each URL
    const results: Array<{
      url: string;
      status: 'ok' | 'error';
      result?: unknown;
      error?: string;
    }> = [];

    let failures = 0;
    for (const url of urls) {
      try {
        // Capture screenshot
        const captureResult = await deps.capture({ url, format: 'png' });

        // Perform analysis
        const exchange = await adapter.analyze({
          imageBytes: captureResult.buffer,
          mediaType: 'image/png',
          task,
          context,
        });

        results.push({
          url,
          status: 'ok',
          result: exchange.result,
        });
      } catch (err) {
        failures += 1;
        results.push({
          url,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // All URLs failed
    if (failures === urls.length) {
      throw new HttpError(502, 'analysis_failed', 'all urls failed to analyze');
    }

    // Record revenue (flat price for batch)
    const payer = x402Payer(req) ?? 'unknown';
    revenue.record({
      endpoint: 'analyze',
      payer,
      revenueUsdcUnits: DEFAULT_ANALYSIS_PRICE_USDC_UNITS,
      costUsdcUnits: config.computeCostUsdcUnitsPerRequest * urls.length,
    });

    return {
      results,
      task,
      payment: {
        payer,
        priceUsdcUnits: DEFAULT_ANALYSIS_PRICE_USDC_UNITS,
        costUsdcUnits: config.computeCostUsdcUnitsPerRequest * urls.length,
      },
    };
  });
}
