/**
 * Guard the build wiring.
 *
 * `npm run build` runs inside the Docker image build, so every file it shells
 * out to must exist, survive `.dockerignore`, and be COPY'd into the build
 * stage. This broke for real: `scripts/copy-assets.mjs` was added to the build
 * script while `scripts/` was (and still is) excluded from the Docker context,
 * so `docker compose build` failed and the container silently kept running the
 * previous image. There is no CI here, so the guard lives in the suite.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (file: string): string => readFileSync(resolve(root, file), 'utf8');

/** File paths a shell command in package.json runs directly (node/sh/bash <file>). */
function buildScriptFiles(buildCommand: string): string[] {
  const matches = buildCommand.matchAll(/(?:^|\s)([\w./-]+\.(?:mjs|cjs|js|ts|sh))(?=\s|$)/g);
  return [...new Set([...matches].map((m) => m[1] as string))];
}

/** Mirrors .dockerignore semantics for one path (later patterns win; `!` re-includes). */
function excludedByDockerignore(file: string, dockerignore: string): boolean {
  const patterns = dockerignore
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  let excluded = false;
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) {
      if (pattern.slice(1) === file) excluded = false;
      continue;
    }
    if (pattern === file || file.startsWith(`${pattern}/`)) excluded = true;
  }
  return excluded;
}

describe('build wiring (npm run build inside the Docker image)', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  const buildCommand = pkg.scripts.build as string;
  const dockerfile = read('Dockerfile');
  const dockerignore = read('.dockerignore');
  const referenced = buildScriptFiles(buildCommand);

  it('the build script references at least one file (the asset copier)', () => {
    expect(buildCommand).toContain('tsc -p tsconfig.json');
    expect(referenced.length).toBeGreaterThan(0);
  });

  it('every file the build script runs exists in the repo', () => {
    for (const file of referenced) expect(existsSync(resolve(root, file)), `${file} is missing`).toBe(true);
  });

  it('every file the build script runs is visible to the Docker build context', () => {
    for (const file of referenced) {
      expect(excludedByDockerignore(file, dockerignore), `${file} is excluded by .dockerignore`).toBe(false);
      expect(dockerfile, `Dockerfile must COPY ${file}`).toContain(file);
    }
  });

  it('the non-TS assets the copier ships exist (schema.sql is read at boot)', () => {
    const copier = read(referenced[0] as string);
    const sources = [...copier.matchAll(/['"](src\/[\w./-]+)['"]/g)].map((m) => m[1] as string);
    expect(sources).toContain('src/db/schema.sql');
    for (const source of sources) expect(existsSync(resolve(root, source)), `${source} is missing`).toBe(true);
  });
});
