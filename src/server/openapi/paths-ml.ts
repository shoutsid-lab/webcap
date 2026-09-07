/**
 * OpenAPI path definitions for ML analysis routes.
 */
import { USDC_SCALE, type WebcapConfig } from '../../config.js';
import { jsonContent, jsonError, type PathContext } from './shared.js';
import type { OpenapiPaths } from './types.js';

/** 6-decimal USDC amount as the fixed-point string (10000 -> '0.010000'). */
const usdAmount = (units: number): string => (units / USDC_SCALE).toFixed(6);

const ML_ANALYSIS_PRICE_USDC_UNITS = 10_000; // $0.01

/**
 * ML analysis paths (POST /v1/x402/analyze, POST /v1/x402/analyze/batch).
 */
export function mlPaths(config: WebcapConfig, ctx: PathContext): OpenapiPaths {
  return {
    '/v1/x402/analyze': {
      post: {
        tags: ['ml'],
        summary: 'AI-powered visual analysis of a web page (paid, x402)',
        description:
          'Capture a screenshot and analyze it with AI. Supports classification, accessibility audit, ' +
          'layout analysis, entity extraction, and sentiment analysis. Requires model configuration ' +
          '(MODEL_API_BASE_URL, MODEL_API_KEY, MODEL_NAME).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['url', 'task'],
                properties: {
                  url: { type: 'string', format: 'uri', description: 'URL to analyze' },
                  task: {
                    type: 'string',
                    enum: ['classification', 'accessibility', 'layout', 'entities', 'sentiment'],
                    description: 'Analysis task type',
                  },
                  context: { type: 'string', description: 'Optional context for the analysis' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Analysis result',
            content: jsonContent({
              type: 'object',
              properties: {
                task: { type: 'string', description: 'Analysis task performed' },
                result: { type: 'object', description: 'Task-specific result' },
                payment: {
                  type: 'object',
                  properties: {
                    payer: { type: 'string' },
                    priceUsdcUnits: { type: 'number' },
                    costUsdcUnits: { type: 'number' },
                  },
                },
                latency_ms: { type: 'number', description: 'Analysis latency in milliseconds' },
              },
            }),
          },
          402: jsonError('402', 'Payment required (x402 challenge)'),
          400: ctx.badInput,
          502: ctx.captureFailed,
          503: jsonError('503', 'Model not configured (MODEL_API_BASE_URL, MODEL_API_KEY, MODEL_NAME required)'),
        },
        'x-payment-info': {
          price: { mode: 'fixed', currency: 'USD', amount: usdAmount(ML_ANALYSIS_PRICE_USDC_UNITS) },
          protocols: [{ x402: {} }, { mpp: { method: 'evm' } }],
        },
      },
    },
    '/v1/x402/analyze/batch': {
      post: {
        tags: ['ml'],
        summary: 'Batch AI-powered visual analysis (paid, x402)',
        description:
          'Analyze multiple URLs with the same AI task. One payment covers the entire batch (up to 10 URLs).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['urls', 'task'],
                properties: {
                  urls: {
                    type: 'array',
                    items: { type: 'string', format: 'uri' },
                    maxItems: 10,
                    description: 'URLs to analyze (max 10)',
                  },
                  task: {
                    type: 'string',
                    enum: ['classification', 'accessibility', 'layout', 'entities', 'sentiment'],
                    description: 'Analysis task type',
                  },
                  context: { type: 'string', description: 'Optional context for the analysis' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Batch analysis results',
            content: jsonContent({
              type: 'object',
              properties: {
                results: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      url: { type: 'string' },
                      status: { type: 'string', enum: ['ok', 'error'] },
                      result: { type: 'object' },
                      error: { type: 'string' },
                    },
                  },
                },
                task: { type: 'string' },
                payment: {
                  type: 'object',
                  properties: {
                    payer: { type: 'string' },
                    priceUsdcUnits: { type: 'number' },
                    costUsdcUnits: { type: 'number' },
                  },
                },
              },
            }),
          },
          402: jsonError('402', 'Payment required (x402 challenge)'),
          400: ctx.badInput,
          502: ctx.captureFailed,
        },
        'x-payment-info': {
          price: { mode: 'fixed', currency: 'USD', amount: usdAmount(ML_ANALYSIS_PRICE_USDC_UNITS) },
          protocols: [{ x402: {} }, { mpp: { method: 'evm' } }],
        },
      },
    },
  };
}
