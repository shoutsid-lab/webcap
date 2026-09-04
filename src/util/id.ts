import { randomBytes } from 'node:crypto';

/** Non-guessable id: `prefix` + '_' + 16 hex chars (64 bits of entropy). */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}
