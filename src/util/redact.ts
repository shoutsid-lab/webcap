/**
 * Deep secret redaction for structured log payloads.
 *
 * The Fastify/pino `redact.paths` policy (src/server/logging.ts) covers the
 * request-log serializer; this helper covers everything else that carries
 * per-watch auth into logs (scheduler run context, error details, debug
 * dumps). Object keys matching a sensitive header/field name
 * (case-insensitive) are replaced with the same '[Redacted]' censor so the
 * two layers agree.
 */
export const REDACT_CENSOR = '[Redacted]';

/** Lower-cased field/header names whose values must never appear in logs. */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'payment-signature',
  'payment-required',
  'x-api-key',
]);

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

/**
 * Deep-clone `value`, replacing every sensitive-keyed string (or nested
 * value) with '[Redacted]'. Primitives pass through; arrays and plain
 * objects are rebuilt so the caller's object is never mutated.
 */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry));
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) ? REDACT_CENSOR : redactSecrets(entry);
    }
    return out;
  }
  return value;
}
