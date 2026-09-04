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

/** Authenticate a `Bearer <key>` header against the api_keys table. Throws 401. */
export function authenticate(req: FastifyRequest, db: Db): AuthContext {
  const rawKey = bearerToken(req.headers.authorization);
  const keys = makeApiKeysRepo(db);
  const found = keys.findLiveByHash(hashKey(rawKey));
  if (found === undefined) throw unauthorized('invalid api key');
  keys.markUsed(found.key.id);
  return found;
}

function bearerToken(header: string | undefined): string {
  if (header === undefined || !header.startsWith('Bearer ')) throw unauthorized('missing bearer token');
  const raw = header.slice('Bearer '.length).trim();
  if (raw === '') throw unauthorized('missing bearer token');
  return raw;
}
