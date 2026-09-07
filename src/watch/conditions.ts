import { badRequest, unprocessable } from '../util/errors.js';
import { isRecord } from '../util/type-guards.js';
import { stableStringify } from './diff.js';

export type WatchChannel = 'generic' | 'slack' | 'discord';

export const WATCH_CHANNELS: readonly WatchChannel[] = ['generic', 'slack', 'discord'];

export type WatchCondition =
  | { readonly type: 'keyword'; readonly keyword: string }
  | { readonly type: 'priceBelow'; readonly jsonPath: string; readonly price: number }
  | { readonly type: 'priceAbove'; readonly jsonPath: string; readonly price: number };

export interface ConditionContext {
  readonly markdown: string | null;
  readonly extract: unknown;
}

const SEGMENT = String.raw`(?:[A-Za-z_][A-Za-z0-9_]*|\d+)`;
const JSON_PATH_RE = new RegExp(`^\\$(?:\\.${SEGMENT}|\\[\\d+\\])*$`);

export function isValidJsonPath(path: string): boolean {
  return JSON_PATH_RE.test(path);
}

export type JsonPathResolution =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

export function resolveJsonPath(doc: unknown, path: string): JsonPathResolution {
  if (!isValidJsonPath(path)) return { ok: false, reason: `invalid jsonPath: ${path}` };
  if (path === '$') return { ok: true, value: doc };
  let current: unknown = doc;
  for (const segment of splitPath(path)) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return { ok: false, reason: `cannot index array with '${segment}'` };
      const index = Number(segment);
      if (index >= current.length) return { ok: false, reason: `array index out of bounds: ${index}` };
      current = current[index];
    } else if (typeof current === 'object' && current !== null) {
      if (!Object.hasOwn(current, segment)) return { ok: false, reason: `missing key: ${segment}` };
      current = (current as Record<string, unknown>)[segment];
    } else {
      return { ok: false, reason: `cannot descend into ${typeof current} at '${segment}'` };
    }
  }
  return { ok: true, value: current };
}

function splitPath(path: string): string[] {
  const out: string[] = [];
  const token = /\.([A-Za-z_][A-Za-z0-9_]*|\d+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(path)) !== null) out.push((match[1] ?? match[2]) as string);
  return out;
}

export function conditionsMatch(conditions: readonly WatchCondition[], ctx: ConditionContext): boolean {
  return conditions.every((condition) => conditionMatches(condition, ctx));
}

function conditionMatches(condition: WatchCondition, ctx: ConditionContext): boolean {
  switch (condition.type) {
    case 'keyword': {
      const haystack =
        ctx.markdown ?? (ctx.extract === null || ctx.extract === undefined ? '' : stableStringify(ctx.extract));
      return haystack.toLowerCase().includes(condition.keyword.toLowerCase());
    }
    case 'priceBelow': {
      const value = numericAtPath(ctx.extract, condition.jsonPath);
      return value !== null && value < condition.price;
    }
    case 'priceAbove': {
      const value = numericAtPath(ctx.extract, condition.jsonPath);
      return value !== null && value > condition.price;
    }
  }
}

function numericAtPath(doc: unknown, path: string): number | null {
  if (doc === null || doc === undefined) return null;
  const resolved = resolveJsonPath(doc, path);
  if (!resolved.ok) return null;
  return typeof resolved.value === 'number' && Number.isFinite(resolved.value) ? resolved.value : null;
}

export function parseConditionsField(raw: unknown): WatchCondition[] | null {
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) throw unprocessable('conditions must be an array');
  return raw.map((entry, index) => parseCondition(entry, index));
}

function parseCondition(entry: unknown, index: number): WatchCondition {
  if (!isRecord(entry)) throw unprocessable(`conditions[${index}] must be an object`);
  const type = entry['type'];
  if (type === 'keyword') {
    const keyword = entry['keyword'];
    if (typeof keyword !== 'string' || keyword === '') {
      throw unprocessable(`conditions[${index}].keyword must be a non-empty string`);
    }
    return { type: 'keyword', keyword };
  }
  if (type === 'priceBelow' || type === 'priceAbove') {
    const jsonPath = entry['jsonPath'];
    if (typeof jsonPath !== 'string' || !isValidJsonPath(jsonPath)) {
      throw unprocessable(`conditions[${index}].jsonPath must be a valid jsonPath ($.a.b.0.c subset)`);
    }
    const price = entry['price'];
    if (typeof price !== 'number' || !Number.isFinite(price)) {
      throw unprocessable(`conditions[${index}].price must be a finite number`);
    }
    return { type, jsonPath, price };
  }
  throw unprocessable(`conditions[${index}].type must be one of: keyword, priceBelow, priceAbove`);
}

export function parseChannel(raw: unknown): WatchChannel {
  if (raw === undefined) return 'generic';
  if (raw === 'generic' || raw === 'slack' || raw === 'discord') return raw;
  throw badRequest(`channel must be one of: ${WATCH_CHANNELS.join(', ')}`);
}

/**
 * Build a ConditionContext from extract JSON (a string or null).
 * Shared by the scheduler and JSON fetch modules.
 */
export function conditionContextOf(extractJson: string | null): ConditionContext {
  let extract: unknown = null;
  if (extractJson !== null) {
    try {
      extract = JSON.parse(extractJson);
    } catch {
      extract = null;
    }
  }
  const markdown =
    typeof extract === 'object' && extract !== null && typeof (extract as Record<string, unknown>)['markdown'] === 'string'
      ? ((extract as Record<string, unknown>)['markdown'] as string)
      : null;
  return { markdown, extract };
}

/**
 * Evaluate stored conditions against extract JSON.
 * Shared by the scheduler and JSON fetch modules.
 * Returns true when no conditions are set or all conditions match.
 */
export function storedConditionsMet(conditionsJson: string | null, extractJson: string | null): boolean {
  if (conditionsJson === null) return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(conditionsJson);
  } catch {
    return false;
  }
  try {
    const conditions = parseConditionsField(parsed);
    return conditions === null ? true : conditionsMatch(conditions, conditionContextOf(extractJson));
  } catch {
    return false;
  }
}
