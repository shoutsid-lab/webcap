/**
 * Copy non-TypeScript runtime assets into dist/ after `tsc`.
 *
 * tsc only emits JS, but the compiled code reads files next to it:
 *   - src/db/index.js  reads  <dir>/schema.sql   (dist/db/schema.sql)
 * Without this step `node dist/main.js` (and any published package) fails at
 * boot with ENOENT. The Dockerfile used to patch this by hand after the build;
 * doing it here means every build (local, Docker, npm publish) is correct.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const assets = [['src/db/schema.sql', 'dist/db/schema.sql']];

for (const [from, to] of assets) {
  mkdirSync(dirname(resolve(to)), { recursive: true });
  copyFileSync(resolve(from), resolve(to));
  console.log(`copied ${from} -> ${to}`);
}
