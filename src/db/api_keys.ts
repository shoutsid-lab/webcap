import type { Db } from './index.js';
import { makeAccountsRepo, type AccountRow } from './accounts.js';

export interface ApiKeyRow {
  readonly id: number;
  readonly account_id: number;
  readonly key_hash: string;
  readonly name: string;
  readonly created_at: string;
  readonly last_used_at: string | null;
  readonly revoked: number;
}

export interface AuthResult {
  readonly account: AccountRow;
  readonly key: ApiKeyRow;
}

export interface ApiKeysRepo {
  create(accountId: number, keyHash: string, name?: string): number;
  findLiveByHash(keyHash: string): AuthResult | undefined;
  markUsed(id: number): void;
}

const now = (): string => new Date().toISOString();

export function makeApiKeysRepo(db: Db): ApiKeysRepo {
  const accounts = makeAccountsRepo(db);
  const insert = db.prepare<[number, string, string, string], unknown>(
    'INSERT INTO api_keys (account_id, key_hash, name, created_at) VALUES (?, ?, ?, ?)',
  );
  const selectLive = db.prepare<[string], ApiKeyRow>(
    `SELECT id, account_id, key_hash, name, created_at, last_used_at, revoked
     FROM api_keys WHERE key_hash = ? AND revoked = 0`,
  );
  const markUsedStmt = db.prepare<[string, number], unknown>(
    'UPDATE api_keys SET last_used_at = ? WHERE id = ?',
  );

  return {
    create(accountId: number, keyHash: string, name: string = 'default'): number {
      const info = insert.run(accountId, keyHash, name, now());
      return Number(info.lastInsertRowid);
    },
    findLiveByHash(keyHash: string): AuthResult | undefined {
      const key = selectLive.get(keyHash);
      if (key === undefined) return undefined;
      const account = accounts.get(key.account_id);
      if (account === undefined) return undefined;
      return { account, key };
    },
    markUsed(id: number): void {
      markUsedStmt.run(now(), id);
    },
  };
}
