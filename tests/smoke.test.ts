import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

// Scaffold smoke: proves the native better-sqlite3 build works on Node 24 and
// that vitest + ESM + tsx toolchain is wired. Fails loudly if the native
// module did not install.
describe('scaffold smoke', () => {
  it('better-sqlite3 initializes a WAL db and round-trips a value', () => {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE t (x INTEGER)');
    db.prepare('INSERT INTO t VALUES (?)').run(42);
    const row = db.prepare('SELECT x FROM t').get() as { x: number };
    expect(row.x).toBe(42);
    db.close();
  });
});
