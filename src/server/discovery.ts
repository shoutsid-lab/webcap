/**
 * Discovery + ops routes: front-door content negotiation, OpenAPI, health,
 * service icon, SEO (robots/sitemap), x402 + agent well-known catalogs, and
 * the artifact download / shareable-page routes. Split out of routes.ts as a
 * pure function move (no behavior change).
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { readFileSync } from 'node:fs';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { CREDITS_PER_USDC, PRICE_PER_CREDIT, type WebcapConfig } from '../config.js';
import { HttpError, unprocessable } from '../util/errors.js';
import { isRecord } from './capture-parse.js';
import type { AppDeps } from './server.js';
import { landingHtml, artifactPageHtml } from './pages.js';
import { openapiDocument } from './openapi.js';
import { agentCard, frontDoorPayload, sitemapXml, x402WellKnown } from './catalogs.js';

export function registerDiscoveryRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { config, artifacts } = deps;

  // Content negotiation: pure-JSON clients (Accept: application/json without
  // text/html) keep getting the JSON front-door payload, byte-for-byte;
  // everyone else gets the product landing page.
  app.get('/', async (req, reply) => {
    if (wantsJsonOnly(acceptOf(req.headers.accept))) {
      return frontDoorPayload(config);
    }
    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(landingHtml(config));
  });

  app.get('/openapi.json', async () => openapiDocument(config));

  app.get('/v1/health', async () => ({
    ok: true,
    chainId: config.chain.chainId,
    creditsPerUsdc: CREDITS_PER_USDC,
    pricePerCredit: PRICE_PER_CREDIT,
  }));

  // Service icon referenced by the x402 bazaar resource.iconUrl.
  app.get('/icon.png', async (_req, reply) => {
    const icon = loadIconPng();
    if (icon === undefined) {
      throw new HttpError(500, 'internal', 'service icon is missing');
    }
    reply.header('content-type', 'image/png');
    reply.header('cache-control', 'public, max-age=86400');
    return reply.send(icon);
  });

  // SEO surface: robots.txt + sitemap.xml, both driven by config.publicBaseUrl.
  app.get('/robots.txt', async (_req, reply) => {
    reply.header('content-type', 'text/plain; charset=utf-8');
    return reply.send(`User-agent: *\nAllow: /\nSitemap: ${config.publicBaseUrl}/sitemap.xml\n`);
  });

  app.get('/sitemap.xml', async (_req, reply) => {
    reply.header('content-type', 'application/xml; charset=utf-8');
    return reply.send(sitemapXml(config));
  });

  app.get('/.well-known/x402', async (_req, reply) => {
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('cache-control', 'public, max-age=300');
    return reply.send(await x402WellKnown(config));
  });

  app.get('/.well-known/agent-card.json', async (_req, reply) => {
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('cache-control', 'public, max-age=300');
    return reply.send(await agentCard(config));
  });

  app.get('/v1/artifacts/:id', async (req, reply) => {
    const rawId = isRecord(req.params) ? req.params.id : undefined;
    if (typeof rawId !== 'string') throw unprocessable('id is required');
    const artifact = artifacts.get(rawId);
    if (artifact === null) throw new HttpError(404, 'not_found', 'artifact not found');
    const query = req.query;
    const expRaw = isRecord(query) ? query.exp : undefined;
    const sigRaw = isRecord(query) ? query.sig : undefined;
    if (expRaw === undefined && sigRaw === undefined) {
      serveArtifact(reply, artifact.mime, artifact.bytes, true);
      return;
    }
    if (typeof expRaw !== 'string' || typeof sigRaw !== 'string') {
      throw new HttpError(403, 'forbidden', 'invalid artifact signature');
    }
    const secret = artifactHmacSecret(config);
    if (secret === undefined) {
      serveArtifact(reply, artifact.mime, artifact.bytes, true);
      return;
    }
    if (!/^\d+$/.test(expRaw)) throw new HttpError(403, 'forbidden', 'invalid artifact signature');
    const expected = createHmac('sha256', secret).update(`${rawId}.${expRaw}`).digest();
    let presented: Buffer;
    try {
      presented = Buffer.from(sigRaw, 'hex');
    } catch {
      throw new HttpError(403, 'forbidden', 'invalid artifact signature');
    }
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
      throw new HttpError(403, 'forbidden', 'invalid artifact signature');
    }
    if (Number(expRaw) <= Math.floor(Date.now() / 1000)) {
      throw new HttpError(410, 'gone', 'signed artifact URL has expired');
    }
    serveArtifact(reply, artifact.mime, artifact.bytes, false);
  });

  // Shareable artifact page: same lookup + 404 semantics as the raw route above,
  // renders Open Graph tags for link previews.
  app.get('/v1/artifacts/:id/page', async (req, reply) => {
    const rawId = isRecord(req.params) ? req.params.id : undefined;
    if (typeof rawId !== 'string') throw unprocessable('id is required');
    const artifact = artifacts.get(rawId);
    if (artifact === null) throw new HttpError(404, 'not_found', 'artifact not found');
    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(artifactPageHtml(config, artifact));
  });
}

// Secret for signed artifact URLs: explicit WEBCAP_ARTIFACT_HMAC_SECRET first,
// merchantPrivateKey fallback, undefined when both are absent (verify disabled,
// unsigned serves). Resolved per request; never logged.
function artifactHmacSecret(config: WebcapConfig): string | undefined {
  if ((config.artifactHmacSecret ?? '').trim() !== '') return (config.artifactHmacSecret ?? '').trim();
  if (config.merchantPrivateKey !== '') return config.merchantPrivateKey;
  return undefined;
}

function serveArtifact(reply: FastifyReply, mime: string, bytes: Buffer, deprecated: boolean): void {
  reply.header('content-type', mime);
  reply.header('content-length', bytes.length);
  if (deprecated) reply.header('Deprecation', 'true');
  void reply.send(bytes);
}

let iconPng: Buffer | undefined;

function loadIconPng(): Buffer | undefined {  if (iconPng === undefined) {
    try {
      iconPng = readFileSync(new URL('../../public/icon.png', import.meta.url));
    } catch {
      return undefined;
    }
  }
  return iconPng;
}

/** Join a possibly multi-valued Accept header; undefined when absent. */
function acceptOf(accept: string | string[] | undefined): string | undefined {
  if (accept === undefined) return undefined;
  return Array.isArray(accept) ? accept.join(',') : accept;
}

/** True when the client explicitly asks for JSON and does not accept HTML. */
function wantsJsonOnly(accept: string | undefined): boolean {
  if (accept === undefined || accept.trim() === '') return false;
  let json = false;
  let html = false;
  for (const part of accept.split(',')) {
    const segments = part.split(';');
    const mediaType = (segments[0] ?? '').trim().toLowerCase();
    if (mediaType === '') continue;
    let q = 1;
    for (const param of segments.slice(1)) {
      const kv = param.trim().split('=');
      if ((kv[0] ?? '').toLowerCase() === 'q' && kv[1] !== undefined) q = Number.parseFloat(kv[1]);
    }
    if (!Number.isFinite(q) || q <= 0) continue;
    if (mediaType === 'application/json' || mediaType === 'application/*' || mediaType === '*/*') json = true;
    if (mediaType === 'text/html' || mediaType === 'text/*' || mediaType === '*/*') html = true;
  }
  return json && !html;
}
