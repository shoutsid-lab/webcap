/**
 * server.json — the official MCP Registry manifest for this deployment.
 *
 * The registry is how an MCP runtime discovers webcap without reading our
 * docs, so this file is an agent-facing surface like any other and it must
 * agree with the service: the remote URL it advertises has to be the route the
 * app actually serves, the version has to be the version we ship, and the name
 * has to satisfy the registry's own namespace rules. A manifest that lies
 * sends an agent to a 404.
 *
 * The stricter check (validating against the registry's published JSON Schema)
 * was run once by hand against
 * https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json
 * while writing this file; these are the durable invariants that keep it true
 * without vendoring a schema that will keep moving.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeApiFixture, closeApiFixture } from '../api/fixture.js';

interface ServerManifest {
  readonly name?: string;
  readonly description?: string;
  readonly version?: string;
  readonly remotes?: ReadonlyArray<{ type?: string; url?: string }>;
  readonly packages?: unknown;
}

const root = process.cwd();
const manifest = JSON.parse(readFileSync(resolve(root, 'server.json'), 'utf8')) as ServerManifest;
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string };

/** The registry's own rule: reverse-DNS namespace, exactly one slash. */
const REGISTRY_NAME = /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/;

describe('server.json — MCP Registry manifest', () => {
  it('uses a registry-valid name and the version this package actually ships', () => {
    expect(manifest.name).toMatch(REGISTRY_NAME);
    // GitHub-based registry auth requires the io.github.<owner>/ namespace.
    expect(manifest.name).toMatch(/^io\.github\./);
    expect(manifest.version).toBe(pkg.version);
  });

  it('describes itself within the registry description limit', () => {
    // The published schema caps description at 100 characters; exceeding it
    // fails validation at publish time.
    expect(manifest.description).toBeTruthy();
    expect((manifest.description ?? '').length).toBeLessThanOrEqual(100);
  });

  it('advertises a streamable-http remote and no package it cannot ship yet', () => {
    expect(manifest.remotes?.length).toBe(1);
    expect(manifest.remotes?.[0]?.type).toBe('streamable-http');
    // The npm path is unpublished, so claiming a package would be a lie.
    expect(manifest.packages).toBeUndefined();
  });

  it('points the remote at a path the app actually serves, on an origin the repo documents', async () => {
    const url = manifest.remotes?.[0]?.url ?? '';
    const { origin, pathname } = new URL(url);

    // server.json describes the production deployment, not the test fixture
    // (whose publicBaseUrl is localhost), so the origin is cross-checked
    // against the origins the committed README documents. If the deployment
    // moves, both surfaces have to move together.
    const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
    const documented = new Set([...readme.matchAll(/https:\/\/[a-z0-9.-]+/gi)].map((m) => m[0].toLowerCase()));
    expect([...documented], `server.json advertises ${origin}, which the README never mentions`).toContain(
      origin.toLowerCase(),
    );

    // And the advertised path must be the real route, not a 404.
    expect(pathname).toBe('/mcp');
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({
        method: 'POST',
        url: pathname,
        payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      });
      expect(res.statusCode, 'the advertised remote must answer, not 404').toBe(200);
      expect((res.json() as { result?: { serverInfo?: { name?: string } } }).result?.serverInfo?.name).toBe('webcap');
    } finally {
      await closeApiFixture(fx);
    }
  });
});
