import { createPrivateKey, randomBytes, sign, type KeyObject } from 'node:crypto';

/**
 * CDP facilitator auth (optional): Ed25519 JWTs bound to a single
 * `METHOD host/path`, one per facilitator path (verify/settle/supported).
 *
 * Spec source: @coinbase/cdp-sdk 1.55.0. The secret is the 64-byte CDP Ed25519
 * key material (32-byte seed + 32-byte public key) base64-encoded; only the
 * seed goes into the PKCS8 DER, the public half stays in the JWT-verifiable
 * signature space. Node's built-in crypto is used — no dependencies.
 */

/** CDP API key pair parsed from CDP_API_KEY_ID / CDP_API_KEY_SECRET. */
export interface CdpApiKey {
  readonly id: string;
  readonly secret: string;
}

/**
 * Per-path header bag as consumed by @x402/core FacilitatorConfig
 * .createAuthHeaders — keyed by facilitator path, NOT a flat headers object.
 */
export interface CdpAuthHeaders {
  readonly verify?: Record<string, string>;
  readonly settle?: Record<string, string>;
  readonly supported?: Record<string, string>;
}

/** Ed25519 PKCS8 DER wrapper around a 32-byte seed. */
const ED25519_PKCS8_SEED_PREFIX_HEX = '302e020100300506032b657004220420';
const CDP_JWT_TTL_SECONDS = 120;
const CDP_CORRELATION_CONTEXT = 'sdkLanguage=typescript,source=webcap,sourceVersion=1.0.0';

function invalidSecretError(why: string): Error {
  return new Error(
    `CDP_API_KEY_SECRET must be a base64-encoded 64-byte Ed25519 key (32-byte seed + 32-byte public key); ${why}`,
  );
}

/** Decode the CDP secret (base64, exactly 64 bytes) into an Ed25519 PKCS8 KeyObject. */
export function parseEd25519PrivateKey(secretB64: string): KeyObject {
  const trimmed = secretB64.trim();
  if (trimmed === '' || trimmed.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    throw invalidSecretError('invalid base64');
  }
  const raw = Buffer.from(trimmed, 'base64');
  if (raw.length !== 64) {
    throw invalidSecretError(`decoded length is ${raw.length} bytes, expected 64`);
  }
  const der = Buffer.concat([Buffer.from(ED25519_PKCS8_SEED_PREFIX_HEX, 'hex'), raw.subarray(0, 32)]);
  try {
    return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  } catch (err) {
    throw invalidSecretError(`not parseable as an Ed25519 PKCS8 key (${err instanceof Error ? err.message : String(err)})`);
  }
}

/** Parameters for a single path-bound CDP JWT. */
export interface CdpJwtParams {
  readonly apiKeyId: string;
  readonly privateKey: KeyObject;
  /** HTTP method of the bound endpoint, e.g. 'POST'. */
  readonly method: string;
  /** Host of the bound endpoint, e.g. 'api.cdp.coinbase.com'. */
  readonly host: string;
  /** Path of the bound endpoint, e.g. '/platform/v2/x402/verify'. */
  readonly path: string;
}

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/**
 * Mint a CDP Ed25519 JWT bound to `${method} ${host}${path}`.
 *
 * Header: `{ alg: 'EdDSA', kid, typ: 'JWT', nonce: <32 hex> }`;
 * claims: `{ sub, iss: 'cdp', uris: [`${method} ${host}${path}`], iat, nbf, exp: iat+120 }`
 * (no `aud`); signature = Ed25519 over `b64url(header).b64url(claims)`.
 * `nowMs` is injectable for deterministic tests (default: wall clock).
 */
export function generateCdpJwt(params: CdpJwtParams, nowMs: number = Date.now()): string {
  const iat = Math.floor(nowMs / 1000);
  const header = {
    alg: 'EdDSA',
    kid: params.apiKeyId,
    typ: 'JWT',
    nonce: randomBytes(16).toString('hex'),
  };
  const claims = {
    sub: params.apiKeyId,
    iss: 'cdp',
    uris: [`${params.method} ${params.host}${params.path}`],
    iat,
    nbf: iat,
    exp: iat + CDP_JWT_TTL_SECONDS,
  };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(claims)}`;
  const signature = sign(null, Buffer.from(signingInput, 'utf8'), params.privateKey);
  return `${signingInput}.${signature.toString('base64url')}`;
}

/**
 * Build the FacilitatorConfig.createAuthHeaders callback for the CDP
 * facilitator. The secret is parsed up front so a bad key fails fast at
 * startup. A fresh JWT is minted per path and per call (Ed25519 signing is
 * cheap; CDP rejects reuse).
 */
export function buildCdpCreateAuthHeaders(
  cdp: CdpApiKey,
  facilitatorBaseUrl: string,
): () => Promise<CdpAuthHeaders> {
  const privateKey = parseEd25519PrivateKey(cdp.secret);
  const { hostname: host, pathname } = new URL(facilitatorBaseUrl);
  const basePath = pathname.replace(/\/+$/, '');
  const headersFor = (method: string, suffix: string): Record<string, string> => ({
    Authorization: `Bearer ${generateCdpJwt({ apiKeyId: cdp.id, privateKey, method, host, path: `${basePath}${suffix}` })}`,
    'Correlation-Context': CDP_CORRELATION_CONTEXT,
  });
  return async (): Promise<CdpAuthHeaders> => ({
    // Methods confirmed against @x402/core HTTPFacilitatorClient fetch calls.
    verify: headersFor('POST', '/verify'),
    settle: headersFor('POST', '/settle'),
    supported: headersFor('GET', '/supported'),
  });
}
