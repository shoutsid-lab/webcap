import { DEFAULT_MODEL_TIMEOUT_MS } from '../config.js';
import { consoleServiceLogger, type ServiceLogger } from '../util/logger.js';

export interface ModelConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

const MAX_HTML_CHARS = 24_000;

/**
 * Best-effort model-based extraction: send the page HTML + a requested schema
 * to an OpenAI-compatible /chat/completions endpoint and return the model's
 * structured JSON. Returns undefined (caller falls back to the deterministic
 * structure) on any failure — no key, network error, timeout, or non-object output.
 */
export async function modelExtract(
  html: string,
  schema: string,
  config: ModelConfig,
  timeoutMs: number = DEFAULT_MODEL_TIMEOUT_MS,
  logger: ServiceLogger = consoleServiceLogger(),
): Promise<Record<string, unknown> | undefined> {
  if (config.apiKey === '' || config.baseUrl === '' || config.model === '') return undefined;
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: 'You extract structured data from web pages. Respond with JSON only, no prose.' },
          {
            role: 'user',
            content: `Extract the following data as a JSON object: ${schema}\n\n--- PAGE ---\n${html.slice(0, MAX_HTML_CHARS)}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    warn(logger, err);
    return undefined;
  }
  if (!response.ok) {
    logger.warn(`webcap model extraction failed: HTTP ${response.status}`);
    return undefined;
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    warn(logger, err);
    return undefined;
  }
  const content = messageContent(data);
  if (content === undefined) {
    logger.warn('webcap model extraction returned no message content');
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      logger.warn('webcap model extraction returned a non-object JSON value');
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    logger.warn('webcap model extraction returned non-JSON content');
    return undefined;
  }
}

function messageContent(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first = choices[0];
  if (typeof first !== 'object' || first === null) return undefined;
  const message = (first as { message?: unknown }).message;
  if (typeof message !== 'object' || message === null) return undefined;
  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' ? content : undefined;
}

function warn(logger: ServiceLogger, err: unknown): void {
  logger.warn(`webcap model extraction unavailable: ${err instanceof Error ? err.message : String(err)}`);
}
