/**
 * JSON utilities for ML vision operations.
 *
 * Ported from resonance-vision/resonance_vision/_json.py with TypeScript
 * adaptations. Provides canonical JSON serialization, digest computation,
 * and bounded JSON validation.
 */
import { createHash } from 'node:crypto';

/**
 * Canonical JSON bytes: recursively sorted keys, no whitespace, no NaN.
 * Matches resonance-vision's canonical_json_bytes() which uses sort_keys=True.
 */
function sortedReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

export function canonicalJsonBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value, sortedReplacer), 'utf-8');
}

/**
 * SHA-256 digest of canonical JSON.
 * Matches resonance-vision's json_digest().
 */
export function jsonDigest(value: unknown): string {
  return createHash('sha256').update(canonicalJsonBytes(value)).digest('hex');
}

/**
 * Strict JSON parse: no NaN, no Infinity.
 * Matches resonance-vision's parse_json_value() error behavior.
 */
export function strictJsonParse(data: Buffer | string): unknown {
  const raw = typeof data === 'string' ? data : data.toString('utf-8');
  // JSON.parse rejects NaN and Infinity by default in strict mode
  return JSON.parse(raw);
}

/**
 * Bounded JSON validation: depth, items, string length, byte size.
 * Matches resonance-vision's validate_bounded_json() constraints.
 */
export function validateBoundedJSON(
  value: unknown,
  limits: {
    maxDepth?: number;
    maxItems?: number;
    maxStringLength?: number;
    maxBytes?: number;
  } = {},
): void {
  const maxDepth = limits.maxDepth ?? 12;
  const maxItems = limits.maxItems ?? 4096;
  const maxStringLength = limits.maxStringLength ?? 32_000;
  const maxBytes = limits.maxBytes ?? 4_096_000;

  const encoded = Buffer.from(JSON.stringify(value), 'utf-8');
  if (encoded.length > maxBytes) {
    throw new Error(`JSON exceeded ${maxBytes} byte limit (${encoded.length} bytes)`);
  }

  function checkDepth(node: unknown, depth: number): void {
    if (depth > maxDepth) {
      throw new Error(`JSON exceeded ${maxDepth} depth limit`);
    }
    if (Array.isArray(node)) {
      if (node.length > maxItems) {
        throw new Error(`JSON array exceeded ${maxItems} item limit (${node.length} items)`);
      }
      for (const item of node) {
        checkDepth(item, depth + 1);
      }
    } else if (node !== null && typeof node === 'object') {
      const keys = Object.keys(node);
      if (keys.length > maxItems) {
        throw new Error(`JSON object exceeded ${maxItems} item limit (${keys.length} keys)`);
      }
      for (const key of keys) {
        if (key.length > maxStringLength) {
          throw new Error(`JSON key exceeded ${maxStringLength} char limit`);
        }
        checkDepth((node as Record<string, unknown>)[key], depth + 1);
      }
    } else if (typeof node === 'string') {
      if (node.length > maxStringLength) {
        throw new Error(`JSON string exceeded ${maxStringLength} char limit (${node.length} chars)`);
      }
    }
  }

  checkDepth(value, 0);
}

/**
 * Extract message content from OpenAI-compatible chat completion response.
 * Matches resonance-vision's _message_content().
 */
export function extractMessageContent(response: Record<string, unknown>): string | undefined {
  const choices = response.choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;

  const first = choices[0] as Record<string, unknown> | undefined;
  if (first === undefined || typeof first !== 'object') return undefined;

  const message = first.message as Record<string, unknown> | undefined;
  if (message === undefined || typeof message !== 'object') return undefined;

  const content = message.content;
  if (typeof content === 'string') return content.trim();

  // Handle array content blocks (multi-modal)
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === 'string') {
        parts.push(block);
      } else if (typeof block === 'object' && block !== null) {
        const text = (block as Record<string, unknown>).text;
        if (typeof text === 'string') parts.push(text);
      }
    }
    return parts.join('');
  }

  return undefined;
}

/**
 * Extract usage statistics from OpenAI-compatible response.
 * Matches resonance-vision's _bounded_usage().
 */
export function extractUsage(data: Record<string, unknown>): {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
} {
  const usage = data.usage as Record<string, unknown> | undefined;
  if (usage === undefined || typeof usage !== 'object') return {};

  const result: Record<string, number> = {};
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
    const value = usage[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      result[key] = value;
    }
  }
  return result;
}
