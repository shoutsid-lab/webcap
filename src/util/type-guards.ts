/**
 * Shared type guard utilities.
 *
 * Extracted from server/capture-parse.ts and watch/conditions.ts to eliminate duplication.
 */

/**
 * Type guard: true when `value` is a non-null, non-array object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
