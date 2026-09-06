import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelConfig } from '../../src/extract/model.js';
import { loadConfig } from '../../src/config.js';

// RED: per-watch/global AI token budgets for watch summarization (fail-open).
// The budget API lives in src/extract/modelSummarize.ts (append-only, T11 owns
// the scheduler) and the env plumbing in src/config.ts. Until the GREEN lands,
// every test below fails because the probed symbols are absent — while tsc
// stays clean, because all budget surface is reached through dynamic lookups
// (static imports of not-yet-existing symbols would break the type gate).
//
// Contract under test:
//   B-1 per-watch window — usage recorded per watch; an exhausted watch gates
//       to null without fetching while a fresh watch still summarizes.
//   B-2 global window   — usage recorded globally; an exhausted global budget
//       gates every watch to null without fetching.
//   B-3 fail-open       — over-budget resolves null with the "AI unevaluated"
//       budget marker, never throws (even when fetch rejects), and never
//       blocks the alert path (webhook delivery proceeds on diffSummary).

const config: ModelConfig = {
  baseUrl: 'http://model.test/v1/',
  apiKey: 'test-api-key',
  model: 'test-model',
};

const DIFF = 'title: "Example Domain" -> "Example Domain (edited)"';
const MODEL_URL = 'http://model.test/v1/chat/completions';
const WEBHOOK_URL = 'https://hooks.example.com/alert';

type BudgetModule = Record<string, unknown>;
type GatedSummarize = (
  diff: string,
  cfg: ModelConfig,
  budget: unknown,
  watchId: string,
  options?: { readonly maxDiffChars?: number; readonly maxRetries?: number },
) => Promise<unknown>;
type BudgetFactory = (options: { readonly maxTokensPerRun: number; readonly maxTokensGlobalWindow: number }) => unknown;
type UsageShape = { readonly prompt: number; readonly completion: number; readonly total: number };
type SummaryShape = { readonly summary: string; readonly usage: UsageShape; readonly cached: false };

async function budgetModule(): Promise<BudgetModule> {
  return (await import('../../src/extract/modelSummarize.js')) as unknown as BudgetModule;
}

async function configModule(): Promise<BudgetModule> {
  return (await import('../../src/config.js')) as unknown as BudgetModule;
}

function asFn(value: unknown, name: string): (...args: never[]) => unknown {
  if (typeof value !== 'function') throw new Error(`RED: ${name} is not implemented yet`);
  return value as (...args: never[]) => unknown;
}

function summaryOf(value: unknown): SummaryShape | null {
  if (value === null) return null;
  if (typeof value !== 'object') throw new Error('RED: gated summarize returned a non-object');
  return value as SummaryShape;
}

/** A 200 chat/completions response carrying assistant `content` + token usage. */
function chatCompletion(content: string, usage: UsageShape): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: 'assistant', content } }],
      usage: { prompt_tokens: usage.prompt, completion_tokens: usage.completion, total_tokens: usage.total },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('watch token budgets B-1 (per-watch window)', () => {
  it('records usage per watch and gates an exhausted watch to null without fetching', async () => {
    const mod = await budgetModule();
    const factory = asFn(mod['createWatchAiTokenBudget'], 'createWatchAiTokenBudget') as unknown as BudgetFactory;
    const gated = asFn(mod['modelSummarizeWithBudget'], 'modelSummarizeWithBudget') as unknown as GatedSummarize;
    const budget = factory({ maxTokensPerRun: 15, maxTokensGlobalWindow: 1_000_000 });

    const fetchMock = vi.fn(async () => chatCompletion('Per-watch summary.', { prompt: 10, completion: 5, total: 15 }));
    vi.stubGlobal('fetch', fetchMock);

    const first = summaryOf(await gated(DIFF, config, budget, 'w-a'));
    expect(first?.summary).toContain('Per-watch summary.');
    expect(first?.usage).toEqual({ prompt: 10, completion: 5, total: 15 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Watch w-a spent its 15-token per-watch window: gated to null, no fetch.
    const gatedResult = summaryOf(await gated(DIFF, config, budget, 'w-a'));
    expect(gatedResult).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A fresh watch is unaffected by w-a's exhaustion.
    const other = summaryOf(await gated(DIFF, config, budget, 'w-b'));
    expect(other?.summary).toContain('Per-watch summary.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('watch token budgets B-2 (global window)', () => {
  it('records usage globally and gates every watch once the window is spent', async () => {
    const mod = await budgetModule();
    const factory = asFn(mod['createWatchAiTokenBudget'], 'createWatchAiTokenBudget') as unknown as BudgetFactory;
    const gated = asFn(mod['modelSummarizeWithBudget'], 'modelSummarizeWithBudget') as unknown as GatedSummarize;
    const budget = factory({ maxTokensPerRun: 1_000_000, maxTokensGlobalWindow: 20 });

    const fetchMock = vi.fn(async () => chatCompletion('Global window summary.', { prompt: 7, completion: 3, total: 10 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(summaryOf(await gated(DIFF, config, budget, 'w-a'))?.summary).toContain('Global window summary.');
    expect(summaryOf(await gated(DIFF, config, budget, 'w-b'))?.summary).toContain('Global window summary.');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // 10 + 10 tokens spent the 20-token global window: every watch gates.
    expect(summaryOf(await gated(DIFF, config, budget, 'w-c'))).toBeNull();
    expect(summaryOf(await gated(DIFF, config, budget, 'w-a'))).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('watch token budgets B-3 (fail-open + marker + alerts)', () => {
  it('over-budget resolves null with the budget marker, never throws, without fetching', async () => {
    const mod = await budgetModule();
    const factory = asFn(mod['createWatchAiTokenBudget'], 'createWatchAiTokenBudget') as unknown as BudgetFactory;
    const gated = asFn(mod['modelSummarizeWithBudget'], 'modelSummarizeWithBudget') as unknown as GatedSummarize;
    const budget = factory({ maxTokensPerRun: 10, maxTokensGlobalWindow: 10 });

    const fetchMock = vi.fn(async () => chatCompletion('Should never be reached.', { prompt: 7, completion: 3, total: 10 }));
    vi.stubGlobal('fetch', fetchMock);
    // Spend the whole global window, then swap in a rejecting fetch: the gate
    // must trip before touching the network, so no rejection can escape.
    expect(summaryOf(await gated(DIFF, config, budget, 'w-spend'))?.summary).toContain('Should never be reached.');
    fetchMock.mockImplementation(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:9');
    });

    let result: unknown;
    let threw: unknown = null;
    try {
      result = await gated(DIFF, config, budget, 'w-late');
    } catch (err: unknown) {
      threw = err;
    }
    expect(threw).toBeNull();
    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const marker = mod['TOKEN_BUDGET_EXCEEDED_MARKER'];
    expect(typeof marker).toBe('string');
    expect(String(marker)).toContain('AI unevaluated');
  });

  it('budget gating never blocks the alert path (webhook delivery proceeds on diffSummary)', async () => {
    const mod = await budgetModule();
    const factory = asFn(mod['createWatchAiTokenBudget'], 'createWatchAiTokenBudget') as unknown as BudgetFactory;
    const gated = asFn(mod['modelSummarizeWithBudget'], 'modelSummarizeWithBudget') as unknown as GatedSummarize;
    // Zero-zero windows: every summarize call gates immediately.
    const budget = factory({ maxTokensPerRun: 0, maxTokensGlobalWindow: 0 });

    const fetchMock = vi.fn(async (url: string) => {
      if (url === WEBHOOK_URL) return new Response('ok', { status: 200 });
      throw new Error(`model fetch must not happen under a spent budget (got ${url})`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const summary = summaryOf(await gated(DIFF, config, budget, 'w-alert'));
    expect(summary).toBeNull();

    // The scheduler alert path keys off changed + diffSummary, not ai_summary:
    // it still fires exactly as before, budget or no budget.
    const alertResponse = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ watchId: 'w-alert', changed: true, diffSummary: 'title', aiSummary: summary }),
    });
    expect(alertResponse.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [alertUrl] = fetchMock.mock.calls[0] ?? [];
    expect(alertUrl).toBe(WEBHOOK_URL);
    expect(MODEL_URL).toContain('/chat/completions');
  });
});

describe('watch token budgets (config plumbing)', () => {
  it('loadConfig parses WATCH_AI_MAX_TOKENS_PER_RUN / _GLOBAL_WINDOW with defaults', async () => {
    const cfgMod = await configModule();
    const perRunDefault = cfgMod['DEFAULT_WATCH_AI_MAX_TOKENS_PER_RUN'];
    const globalDefault = cfgMod['DEFAULT_WATCH_AI_MAX_TOKENS_GLOBAL_WINDOW'];
    expect(typeof perRunDefault).toBe('number');
    expect(typeof globalDefault).toBe('number');

    const base = { WEBCAP_CHAIN: 'base-sepolia', WEBCAP_PUBLIC_BASE_URL: 'http://localhost:8080' };
    const defaults = loadConfig({ ...base }) as unknown as Record<string, unknown>;
    expect(defaults['watchAiMaxTokensPerRun']).toBe(perRunDefault);
    expect(defaults['watchAiMaxTokensGlobalWindow']).toBe(globalDefault);

    const overridden = loadConfig({
      ...base,
      WATCH_AI_MAX_TOKENS_PER_RUN: '1234',
      WATCH_AI_MAX_TOKENS_GLOBAL_WINDOW: '5678',
    }) as unknown as Record<string, unknown>;
    expect(overridden['watchAiMaxTokensPerRun']).toBe(1_234);
    expect(overridden['watchAiMaxTokensGlobalWindow']).toBe(5_678);

    for (const bad of ['0', '-5', 'abc']) {
      expect(() => loadConfig({ ...base, WATCH_AI_MAX_TOKENS_PER_RUN: bad })).toThrow(/WATCH_AI_MAX_TOKENS_PER_RUN/);
      expect(() => loadConfig({ ...base, WATCH_AI_MAX_TOKENS_GLOBAL_WINDOW: bad })).toThrow(
        /WATCH_AI_MAX_TOKENS_GLOBAL_WINDOW/,
      );
    }
  });
});
