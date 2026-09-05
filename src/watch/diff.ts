/**
 * Change detection for watch runs.
 *
 * - capture mode: the artifact bytes are fingerprinted with sha256.
 * - extract mode: the extract JSON is compared field-by-field (top-level +
 *   nested objects and arrays); changed paths are reported as a compact,
 *   stably-ordered summary (e.g. "title, paragraphs[2], links[0]").
 */
import { createHash } from 'node:crypto';

/** sha256 of a byte buffer, lowercase hex. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deterministic JSON: object keys sorted lexicographically at every level, so
 * baseline storage and diffing never depend on key insertion order.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = sortValue(value[key]);
    return out;
  }
  return value;
}

/** Result of a field-level JSON comparison. */
export interface JsonDiff {
  readonly changed: boolean;
  /** Deepest changed paths, stably ordered (object keys sorted, array indices ascending). */
  readonly paths: readonly string[];
}

/**
 * Compare two JSON values field by field. Objects recurse into the union of
 * their keys (missing on either side = changed); arrays compare index by index
 * (a missing element = changed); any other type mismatch or leaf difference
 * reports the current path.
 */
export function diffJson(oldValue: unknown, newValue: unknown): JsonDiff {
  const paths: string[] = [];
  collectPaths(oldValue, newValue, '', paths);
  return { changed: paths.length > 0, paths };
}

function collectPaths(oldValue: unknown, newValue: unknown, prefix: string, out: string[]): void {
  if (isPlainObject(oldValue) && isPlainObject(newValue)) {
    const keys = new Set<string>([...Object.keys(oldValue), ...Object.keys(newValue)]);
    for (const key of [...keys].sort()) {
      const inOld = Object.hasOwn(oldValue, key);
      const inNew = Object.hasOwn(newValue, key);
      if (inOld !== inNew) {
        out.push(joinPath(prefix, key));
        continue;
      }
      collectPaths(oldValue[key], newValue[key], joinPath(prefix, key), out);
    }
    return;
  }
  if (Array.isArray(oldValue) && Array.isArray(newValue)) {
    const length = Math.max(oldValue.length, newValue.length);
    for (let i = 0; i < length; i += 1) {
      const path = `${prefix}[${i}]`;
      if (i >= oldValue.length || i >= newValue.length) {
        out.push(path);
        continue;
      }
      collectPaths(oldValue[i], newValue[i], path, out);
    }
    return;
  }
  if (!leafEqual(oldValue, newValue)) out.push(prefix);
}

function leafEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  return a === b;
}

function joinPath(prefix: string, key: string): string {
  return prefix === '' ? key : `${prefix}.${key}`;
}
