/**
 * MPP (merchant prepaid / MPP scan) opt-in config: the MppConfig type, the
 * pure parse helpers (parseMppSecret, realmOf), and loadMppConfig.
 *
 * MPP is disabled by default (MPP_SECRET_KEY unset/empty -> x402-only, the
 * current behavior). Setting MPP_SECRET_KEY to a value that decodes to
 * >=32 bytes enables it. The secret is held as a Buffer and must never be
 * logged. The chain context (chainId) is passed in by the caller (derived
 * from the active WebcapConfig); it defaults to Base mainnet (8453).
 */

export interface MppConfig {
  /** Raw key material; empty when MPP is disabled. Never log this value. */
  readonly secret: Buffer;
  /** Scheme+host origin the MPP session is bound to (no path). */
  readonly realm: string;
  /** True when MPP_SECRET_KEY decoded to >=32 bytes. */
  readonly enabled: boolean;
  /** Caller-supplied chain context (default: Base mainnet). */
  readonly chainId: number;
}

export const MPP_MIN_SECRET_BYTES = 32;
export const MPP_DEFAULT_CHAIN_ID = 8453;

/** Decode MPP_SECRET_KEY (raw UTF-8 passphrase or hex) to >=32 bytes; throws otherwise. */
export function parseMppSecret(raw: string): Buffer {
  const trimmed = raw.trim();
  if (trimmed === '') throw new Error('MPP_SECRET_KEY must not be empty');
  const hexBody = trimmed.startsWith('0x') ? trimmed.slice(2) : tryBareHex(trimmed);
  if (hexBody !== undefined) {
    if (hexBody.length === 0 || hexBody.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hexBody)) {
      throw new Error('MPP_SECRET_KEY is not valid hex');
    }
    const decoded = Buffer.from(hexBody, 'hex');
    if (decoded.length < MPP_MIN_SECRET_BYTES) {
      throw new Error(`MPP_SECRET_KEY decodes to ${decoded.length} bytes (min ${MPP_MIN_SECRET_BYTES})`);
    }
    return decoded;
  }
  if (Buffer.byteLength(trimmed, 'utf8') < MPP_MIN_SECRET_BYTES) {
    throw new Error(`MPP_SECRET_KEY is ${Buffer.byteLength(trimmed, 'utf8')} bytes as UTF-8 (min ${MPP_MIN_SECRET_BYTES})`);
  }
  return Buffer.from(trimmed, 'utf8');
}

/**
 * A bare (0x-less) value counts as hex only when it is unambiguous key
 * material: all hex chars, even length, decoding to >=32 bytes. Anything
 * else is a UTF-8 passphrase (which may then fail the 32-byte minimum).
 */
function tryBareHex(trimmed: string): string | undefined {
  if (trimmed.length >= MPP_MIN_SECRET_BYTES * 2 && trimmed.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(trimmed)) {
    return trimmed;
  }
  return undefined;
}

/** Scheme+host origin of a URL (path stripped); throws on an invalid URL. */
export function realmOf(raw: string): string {
  try {
    return new URL(raw).origin;
  } catch {
    throw new Error(`invalid MPP realm URL: ${raw}`);
  }
}

/**
 * Parse the MPP environment. MPP_SECRET_KEY unset/empty -> disabled
 * (x402-only); set -> must decode to >=32 bytes (throws at startup).
 */
export function loadMppConfig(
  env: NodeJS.ProcessEnv,
  publicBaseUrl: string,
  chainId: number = MPP_DEFAULT_CHAIN_ID,
): MppConfig {
  const raw = (env.MPP_SECRET_KEY ?? '').trim();
  const realm = realmOf(publicBaseUrl);
  if (raw === '') return { secret: Buffer.alloc(0), realm, enabled: false, chainId };
  return { secret: parseMppSecret(raw), realm, enabled: true, chainId };
}
