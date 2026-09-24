import type { FastifyRequest } from 'fastify';
import type { Db } from '../db/index.js';
import { type AccountRow } from '../db/accounts.js';
import { makeApiKeysRepo, type ApiKeyRow } from '../db/api_keys.js';
import { unauthorized } from '../util/errors.js';
import { hashKey } from '../util/keys.js';

export interface AuthContext {
  readonly account: AccountRow;
  readonly key: ApiKeyRow;
}

/**
 * How an agent without a key gets one. Attached to every 401 so a bearer
 * rejection is a recipe, not a dead end. Relative paths: the caller already
 * knows the host it is talking to.
 */
const REGISTER_HINT = {
  register: 'POST /v1/register',
  example: { address: '0xYourWalletAddress' },
  guide: '/skill.md',
};

/** Authenticate a `Bearer <key>` header against the api_keys table. Throws 401. */
export function authenticate(req: FastifyRequest, db: Db): AuthContext {
  const rawKey = bearerToken(req.headers.authorization);
  const keys = makeApiKeysRepo(db);
  const found = keys.findLiveByHash(hashKey(rawKey));
  if (found === undefined)
    throw unauthorized('invalid api key', {
      ...REGISTER_HINT,
      note: 'that key is unknown or revoked; register again for a fresh key, then send it as Authorization: Bearer <key>',
    });
  keys.markUsed(found.key.id);
  return found;
}

function bearerToken(header: string | undefined): string {
  if (header === undefined || !header.startsWith('Bearer ')) throw unauthorized('missing bearer token', REGISTER_HINT);
  const raw = header.slice('Bearer '.length).trim();
  if (raw === '') throw unauthorized('missing bearer token', REGISTER_HINT);
  return raw;
}
