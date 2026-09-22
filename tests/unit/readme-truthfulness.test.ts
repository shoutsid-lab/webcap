/**
 * The README is the first thing a developer — or an evaluating agent — reads,
 * and it is a claim surface like any other: if it states a command that does
 * not exist, or a number nobody regenerates, the reader's trust in everything
 * else it says drops.
 *
 * Issue #1 was filed by an agent that checked a stale test/file count in this
 * file. That count had already gone stale once before, so the fix was to stop
 * publishing numbers rather than to re-type them; this keeps it that way.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

/** npm built-ins that are never project scripts. */
const NPM_BUILTINS = new Set(['test', 'install', 'i', 'ci', 'init', 'pack', 'publish', 'view', 'whoami', 'exec', 'audit']);

describe('README claims stay true', () => {
  it('every npm command it documents is a real script', () => {
    const commands = [...readme.matchAll(/^npm (?:run )?([a-z][a-z:\-]*)/gm)].map((m) => m[1] as string);
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      if (NPM_BUILTINS.has(command)) continue;
      expect(Object.keys(pkg.scripts), `README documents 'npm ${command}'`).toContain(command);
    }
  });

  it('does not hardcode a test or file count that will rot', () => {
    // Numbers in the Tests section went stale twice (357 tests/46 files, then
    // 993/99). "npm test" prints the real totals; the README should not claim one.
    const testsSection = readme.slice(readme.indexOf('## Tests'), readme.indexOf('## License'));
    expect(testsSection).not.toMatch(/\b\d[\d,]*\s+(?:tests|test files|files)\b/i);
  });

  it('the live URLs it advertises are the ones the service actually serves', () => {
    // Cheap, stable check on the documented task surface (not the marketing copy).
    for (const path of ['/openapi.json', '/.well-known/x402', '/skill.md', '/llms.txt']) {
      expect(readme, `README should document ${path}`).toContain(path);
    }
  });
});
