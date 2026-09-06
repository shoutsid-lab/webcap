import { DEFAULT_MODEL_TIMEOUT_MS } from '../config.js';
import { isRetryableStatus, withAiRetry } from './aiRetry.js';
import type { ModelConfig } from './model.js';

export interface ModelSummarizeOptions {
  /** Per-attempt fetch abort budget (default DEFAULT_MODEL_TIMEOUT_MS). */
  readonly timeoutMs?: number;
  /** Retries after the first attempt (default 2). Maps to aiRetry maxAttempts. */
  readonly maxRetries?: number;
  /** Diffs longer than this resolve null without fetching (default 8_000). */
  readonly maxDiffChars?: number;
}

export interface ModelUsage {
  readonly prompt: number;
  readonly completion: number;
  readonly total: number;
}

export interface ModelSummary {
  readonly summary: string;
  readonly usage: ModelUsage;
  /** Always false: this implementation has no cache layer; fail-open results are never cached. */
  readonly cached: false;
}

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_DIFF_CHARS = 8_000;

const SYSTEM_PROMPT =
  'You summarize website changes for a monitoring service. Respond with a concise summary only, no reasoning preamble.';

interface RetryableHttpError extends Error {
  readonly status: number;
  readonly headers: Headers;
}

/**
 * Best-effort model-based summarization: send a change diff to an
 * OpenAI-compatible /chat/completions endpoint and return the model's summary
 * plus token usage. Fail-open everywhere: budget overruns, transport failures,
 * HTTP errors, and exhausted retries resolve null; 200 responses with no
 * usable message content resolve an "AI unevaluated — raw diff" marker. Never
 * throws to the caller.
 */
export async function modelSummarize(
  diff: string,
  config: ModelConfig,
  options: ModelSummarizeOptions = {},
): Promise<ModelSummary | null> {
  try {
    const timeoutMs = options.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;
    const maxDiffChars = options.maxDiffChars ?? DEFAULT_MAX_DIFF_CHARS;
    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    if (config.apiKey === '' || config.baseUrl === '' || config.model === '') return null;
    if (diff.length > maxDiffChars) return null;
    const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const body = requestBody(config.model, diff);
    const maxAttempts = Math.max(1, Math.floor(maxRetries) + 1);
    return await withAiRetry<ModelSummary | null>(
      async () => {
        let response: Response;
        try {
          response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
            body,
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch {
          // Transport failure: terminal null without retry. The RED contract
          // pins exactly one fetch on rejection, while aiRetry treats
          // status-less errors as retryable — so this must not propagate.
          return null;
        }
        if (!response.ok) {
          if (isRetryableStatus(response.status)) throw retryableError(response);
          return null;
        }
        let data: unknown;
        try {
          data = await response.json();
        } catch {
          return failOpen(diff);
        }
        const raw = messageContent(data);
        const summary = raw === undefined ? undefined : stripReasoning(raw);
        if (summary === undefined || summary === '') return failOpen(diff);
        return { summary, usage: extractUsage(data), cached: false };
      },
      { maxAttempts, timeoutMs },
    );
  } catch {
    return null;
  }
}

/**
 * NOTE: the diff is interpolated raw (not via JSON.stringify) because the
 * binding RED spec asserts `init.body` contains the literal diff string, and
 * JSON.stringify would escape its quotes. The envelope stays JSON-shaped.
 */
function requestBody(model: string, diff: string): string {
  const userContent = `Summarize the following website change in one or two sentences:\n\n--- CHANGE ---\n${diff}`;
  return (
    `{"model":${JSON.stringify(model)},"messages":[` +
    `{"role":"system","content":${JSON.stringify(SYSTEM_PROMPT)}},` +
    `{"role":"user","content":"${escapeForBody(userContent)}"}` +
    `]}`
  );
}

/** Escape backslashes and control chars, but leave quotes raw so the literal diff text survives. */
function escapeForBody(content: string): string {
  return content
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function retryableError(response: Response): RetryableHttpError {
  return Object.assign(new Error(`webcap model summarization failed: HTTP ${response.status}`), {
    status: response.status,
    headers: response.headers,
  });
}

function failOpen(diff: string): ModelSummary {
  return {
    summary: `AI unevaluated — raw diff:\n${diff}`,
    usage: { prompt: 0, completion: 0, total: 0 },
    cached: false,
  };
}

/** Assistant message text: plain string content, or joined array content blocks. */
function messageContent(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first: unknown = choices[0];
  if (typeof first !== 'object' || first === null) return undefined;
  const message = (first as { message?: unknown }).message;
  if (typeof message !== 'object' || message === null) return undefined;
  const content: unknown = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === 'string') {
        parts.push(block);
        continue;
      }
      if (typeof block === 'object' && block !== null) {
        const text: unknown = (block as { text?: unknown }).text;
        if (typeof text === 'string') parts.push(text);
      }
    }
    return parts.join('');
  }
  return undefined;
}

/** Strip <think> reasoning traces (closed blocks plus any unclosed tail), then trim. */
function stripReasoning(content: string): string {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .trim();
}

function extractUsage(data: unknown): ModelUsage {
  if (typeof data === 'object' && data !== null) {
    const usage: unknown = (data as { usage?: unknown }).usage;
    if (typeof usage === 'object' && usage !== null) {
      const record = usage as Record<string, unknown>;
      return {
        prompt: toCount(record['prompt_tokens']),
        completion: toCount(record['completion_tokens']),
        total: toCount(record['total_tokens']),
      };
    }
  }
  return { prompt: 0, completion: 0, total: 0 };
}

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Fail-open marker for token-budget gating: when the per-watch or global
 * window is spent, modelSummarizeWithBudget resolves null without fetching
 * and T11 stores this marker as the run's ai_summary. Alerts never depend on
 * it — the scheduler keys change alerts off changed + diffSummary only.
 */
export const TOKEN_BUDGET_EXCEEDED_MARKER = 'AI unevaluated — token budget exceeded';

export interface WatchAiTokenBudgetOptions {
  /** Max model tokens chargeable to one watch's window (0 = everything gates). */
  readonly maxTokensPerRun: number;
  /** Max model tokens chargeable to the shared global window (0 = everything gates). */
  readonly maxTokensGlobalWindow: number;
}

/** In-memory token counter with per-watch + global windows (fail-open only). */
export interface WatchAiTokenBudget {
  readonly maxTokensPerRun: number;
  readonly maxTokensGlobalWindow: number;
  /** Tokens recorded across all watches since construction (or reset). */
  readonly usedTotal: number;
  /** Tokens recorded for one watch since construction (or reset); 0 when unseen. */
  usedFor(watchId: string): number;
  /** True when the watch's window or the global window is spent. */
  isOverBudget(watchId: string): boolean;
  /** Add tokens to the watch's window and the global window; never throws. */
  record(watchId: string, tokens: number): void;
  /** Clear per-watch and global counters (window rollover). */
  reset(): void;
}

/** Build a token budget; negative/non-integer caps clamp to 0 (gate-all). */
export function createWatchAiTokenBudget(options: WatchAiTokenBudgetOptions): WatchAiTokenBudget {
  const maxTokensPerRun = clampBudget(options.maxTokensPerRun);
  const maxTokensGlobalWindow = clampBudget(options.maxTokensGlobalWindow);
  const perWatch = new Map<string, number>();
  let usedTotal = 0;
  return {
    maxTokensPerRun,
    maxTokensGlobalWindow,
    get usedTotal(): number {
      return usedTotal;
    },
    usedFor(watchId: string): number {
      return perWatch.get(watchId) ?? 0;
    },
    isOverBudget(watchId: string): boolean {
      return (perWatch.get(watchId) ?? 0) >= maxTokensPerRun || usedTotal >= maxTokensGlobalWindow;
    },
    record(watchId: string, tokens: number): void {
      const chargeable = clampBudget(tokens);
      if (chargeable === 0) return;
      perWatch.set(watchId, (perWatch.get(watchId) ?? 0) + chargeable);
      usedTotal += chargeable;
    },
    reset(): void {
      perWatch.clear();
      usedTotal = 0;
    },
  };
}

function clampBudget(value: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * Budget-gated modelSummarize for the watch scheduler (T11 call site):
 * over-budget resolves null WITHOUT fetching and never throws, so change
 * alerts always proceed; under budget it delegates and charges usage.total
 * (null results charge nothing) to the watch's window and the global window.
 */
export async function modelSummarizeWithBudget(
  diff: string,
  config: ModelConfig,
  budget: WatchAiTokenBudget,
  watchId: string,
  options: ModelSummarizeOptions = {},
): Promise<ModelSummary | null> {
  try {
    if (budget.isOverBudget(watchId)) return null;
    const result = await modelSummarize(diff, config, options);
    if (result !== null) budget.record(watchId, result.usage.total);
    return result;
  } catch {
    return null;
  }
}
