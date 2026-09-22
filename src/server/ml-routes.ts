/**
 * ML analysis routes for webcap.
 *
 * Provides visual analysis endpoints that leverage the ML intelligence layer.
 * These routes use the vision adapter for AI-powered page analysis.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Db } from '../db/index.js';
import type { WebcapConfig } from '../config.js';
import { makeTrialsRepo } from '../db/trials.js';
import { HttpError, unprocessable } from '../util/errors.js';
import { RateLimiter } from '../util/ratelimit.js';
import { isRecord, validatedUrl } from './capture-parse.js';
import { checkTrialClaim, howToPayFor, remainingTrials, reserveTrialClaim, trialPaidNextFor, type TrialGate } from './trial-auth.js';
import { x402Payer } from './x402.js';
import { OpenAICompatibleVisionAdapter, VisionError } from '../ml/vision/adapter.js';
import { validateTask } from '../ml/vision/contracts.js';
import { deterministicAnalyze } from '../ml/deterministic.js';
import type { AppDeps } from './server.js';

// Analyze is priced at the extract tier; read from config so the 402 challenge, ledger, and OpenAPI doc agree.

export interface MLRouteDeps {
  readonly db: Db;
  readonly config: WebcapConfig;
  readonly captureAllowHosts?: readonly string[];
}

function modelConfigured(config: WebcapConfig): boolean {
  return config.modelApiBaseUrl !== '' && config.modelApiKey !== '' && config.modelName !== '';
}

function parseTask(rawTask: unknown): 'classification' | 'accessibility' | 'layout' | 'entities' | 'sentiment' {
  if (typeof rawTask !== 'string') throw unprocessable('task is required');
  let task: 'classification' | 'accessibility' | 'layout' | 'entities' | 'sentiment' | 'diff';
  try {
    task = validateTask(rawTask);
  } catch {
    throw unprocessable(`unsupported task: ${rawTask}. Supported: classification, accessibility, layout, entities, sentiment`);
  }
  if (task === 'diff') {
    throw unprocessable('diff needs two captures: create a watch (POST /v1/watches) and compare runs, or top up change detection via POST /v1/x402/watches/topup');
  }
  return task;
}

function visionAdapter(config: WebcapConfig): OpenAICompatibleVisionAdapter {
  return new OpenAICompatibleVisionAdapter({
    baseUrl: config.modelApiBaseUrl,
    model: config.modelName,
    apiKey: config.modelApiKey,
    timeoutMs: config.modelTimeoutMs ?? 30_000,
    allowRemoteEndpoint: true,
  });
}

function recordAnalyzeRevenue(req: FastifyRequest, config: WebcapConfig, urls: number): { payer: string; priceUsdcUnits: number; costUsdcUnits: number } {
  const payer = x402Payer(req) ?? 'unknown';
  const priceUsdcUnits = config.x402ExtractPriceUsdcUnits;
  const costUsdcUnits = config.computeCostUsdcUnitsPerRequest * urls;
  (req as unknown as { _pendingRevenue?: { endpoint: string; payer: string; revenueUsdcUnits: number; costUsdcUnits: number } })._pendingRevenue = {
    endpoint: 'analyze',
    payer,
    revenueUsdcUnits: priceUsdcUnits,
    costUsdcUnits,
  };
  return { payer, priceUsdcUnits, costUsdcUnits };
}

/**
 * Register ML analysis routes.
 */
export function registerMLRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { config } = deps;
  const allowHosts = deps.captureAllowHosts;
  const trialGate: TrialGate = {
    trials: makeTrialsRepo(deps.db),
    limiter: new RateLimiter(5, 60_000),
    config,
  };

  // Free trial analyze: deterministic single-URL analysis (no model call even
  // when the deployment has a model configured — model-backed analysis stays
  // paid). The response carries the same deterministic shape as the paid
  // fallback path.
  app.post('/v1/x402/trial/analyze', async (req, reply) => {
    const body = req.body;
    if (!isRecord(body)) throw unprocessable('body must be an object');
    const rawUrl = body.url;
    if (typeof rawUrl !== 'string') throw unprocessable('url is required');
    const payer = checkTrialClaim(req, reply, trialGate, 'analyze');
    const url = validatedUrl(rawUrl, allowHosts);
    const task = parseTask(body.task);
    const context = typeof body.context === 'string' ? body.context : undefined;
    reserveTrialClaim(trialGate, payer, 'analyze');
    let captured;
    try {
      captured = await deps.captureStructured({ url, options: { includeHtml: true } });
    } catch (err) {
      trialGate.trials.release(payer, 'analyze');
      throw new HttpError(502, 'capture_failed', `failed to capture page: ${err instanceof Error ? err.message : String(err)}`);
    }
    const result = deterministicAnalyze({ structure: captured.structure, html: captured.html, pageUrl: url, task, context });
    return {
      task,
      result,
      trial: { payer, endpoint: 'analyze', priceUsdcUnits: 0, model: 'deterministic (trial)' },
      paidNext: trialPaidNextFor(config, 'analyze'),
      remaining: remainingTrials(trialGate.trials, payer),
      howToPay: howToPayFor(config),
    };
  });

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
    const task = parseTask(rawTask);

    const context = typeof body.context === 'string' ? body.context : undefined;

    const started = performance.now();
    if (modelConfigured(config)) {
      const adapter = visionAdapter(config);
      let captureResult;
      try {
        captureResult = await deps.capture({ url, format: 'png' });
      } catch (err) {
        throw new HttpError(502, 'capture_failed', `failed to capture screenshot: ${err instanceof Error ? err.message : String(err)}`);
      }
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
      const payment = recordAnalyzeRevenue(req, config, 1);
      return {
        task,
        result: exchange.result,
        payment,
        latency_ms: Math.round(latencyMs),
      };
    }

    let captured;
    try {
      captured = await deps.captureStructured({ url, options: { includeHtml: true } });
    } catch (err) {
      throw new HttpError(502, 'capture_failed', `failed to capture page: ${err instanceof Error ? err.message : String(err)}`);
    }
    const result = deterministicAnalyze({ structure: captured.structure, html: captured.html, pageUrl: url, task, context });
    const latencyMs = Math.max(0, performance.now() - started);
    const payment = recordAnalyzeRevenue(req, config, 1);
    return {
      task,
      result,
      payment,
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
    const task = parseTask(rawTask);

    const context = typeof body.context === 'string' ? body.context : undefined;

    // Validate URLs
    const urls: string[] = [];
    for (const rawUrl of rawUrls) {
      if (typeof rawUrl !== 'string') throw unprocessable('each url must be a string');
      urls.push(validatedUrl(rawUrl, allowHosts));
    }

    const results: Array<{
      url: string;
      status: 'ok' | 'error';
      result?: unknown;
      error?: string;
    }> = [];

    if (modelConfigured(config)) {
      const adapter = visionAdapter(config);
      let failures = 0;
      for (const url of urls) {
        try {
          const captureResult = await deps.capture({ url, format: 'png' });
          const exchange = await adapter.analyze({
            imageBytes: captureResult.buffer,
            mediaType: 'image/png',
            task,
            context,
          });
          results.push({ url, status: 'ok', result: exchange.result });
        } catch (err) {
          failures += 1;
          results.push({ url, status: 'error', error: err instanceof Error ? err.message : String(err) });
        }
      }
      if (failures === urls.length) {
        throw new HttpError(502, 'analysis_failed', 'all urls failed to analyze');
      }
      const payment = recordAnalyzeRevenue(req, config, urls.length);
      return { results, task, payment };
    }

    let failures = 0;
    for (const url of urls) {
      try {
        const captured = await deps.captureStructured({ url, options: { includeHtml: true } });
        results.push({
          url,
          status: 'ok',
          result: deterministicAnalyze({ structure: captured.structure, html: captured.html, pageUrl: url, task, context }),
        });
      } catch (err) {
        failures += 1;
        results.push({ url, status: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (failures === urls.length) {
      throw new HttpError(502, 'analysis_failed', 'all urls failed to analyze');
    }
    const payment = recordAnalyzeRevenue(req, config, urls.length);
    return { results, task, payment };
  });
}
