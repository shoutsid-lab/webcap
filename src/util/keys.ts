import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Generate a live API key: `wc_live_` + 32 hex chars (128 bits of entropy). */
export function generateApiKey(): string {
  return `wc_live_${randomBytes(16).toString('hex')}`;
}

/** sha256 hex digest of a key — the only form stored in the database. */
export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Constant-time comparison of a key against a stored sha256 hex hash.
 * Returns false when the hash is not a valid 32-byte digest.
 */
export function verifyKey(key: string, hash: string): boolean {
  const candidate = createHash('sha256').update(key).digest();
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== candidate.length) return false;
  return timingSafeEqual(candidate, expected);
}
