/**
 * Discovery + ops routes: front-door content negotiation, OpenAPI, health,
 * service icon, SEO (robots/sitemap), x402 + agent well-known catalogs, and
 * the artifact download / shareable-page routes. Split out of routes.ts as a
 * pure function move (no behavior change).
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { readFileSync } from 'node:fs';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { CREDITS_PER_USDC, PRICE_PER_CREDIT, USDC_SCALE, type WebcapConfig } from '../config.js';
import { HttpError, unprocessable } from '../util/errors.js';
import { isRecord } from './capture-parse.js';
import type { AppDeps } from './server.js';
import { landingHtml, compareHtml, quickstartHtml, buyHtml, artifactPageHtml, transparencyHtml, type TransparencyStats } from './pages.js';
import { openapiDocument } from './openapi.js';
import { agentCard, frontDoorPayload, mcpTools, openaiTools, sitemapXml, x402WellKnown } from './catalogs.js';

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

  // Pricing comparison page: webcap vs SaaS alternatives
  app.get('/compare', async (_req, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(compareHtml(config));
  });

  // Quick start guide: developer-friendly walkthrough of x402 payment flow
  app.get('/quickstart', async (_req, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(quickstartHtml(config));
  });

  // Buy credits page: credit pack purchase with card and crypto payment options
  app.get('/buy', async (_req, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(buyHtml(config));
  });

  app.get('/openapi.json', async () => openapiDocument(config));

  app.get('/v1/health', async () => {
    // Lightweight DB check — a simple query to confirm SQLite is responsive
    let dbOk = true;
    try {
      deps.db.prepare('SELECT 1').get();
    } catch {
      dbOk = false;
    }
    const uptimeSeconds = Math.floor((Date.now() - (deps.startTimeMs ?? Date.now())) / 1000);
    return {
      ok: dbOk,
      uptimeSeconds,
      chainId: config.chain.chainId,
      creditsPerUsdc: CREDITS_PER_USDC,
      pricePerCredit: PRICE_PER_CREDIT,
    };
  });

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

  // Alias probes seen from agent crawlers: same payloads under the alternate
  // well-known names (byte-identical to the canonical paths above).
  app.get('/.well-known/agent.json', async (_req, reply) => {
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('cache-control', 'public, max-age=300');
    return reply.send(await agentCard(config));
  });

  app.get('/.well-known/x402.json', async (_req, reply) => {
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('cache-control', 'public, max-age=300');
    return reply.send(await x402WellKnown(config));
  });

  // Prober convention seen in the wild (crawler 404s): same catalog under
  // the x402-resources names, byte-identical to the canonical path above.
  app.get('/.well-known/x402-resources', async (_req, reply) => {
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('cache-control', 'public, max-age=300');
    return reply.send(await x402WellKnown(config));
  });

  app.get('/x402-resources', async (_req, reply) => {
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('cache-control', 'public, max-age=300');
    return reply.send(await x402WellKnown(config));
  });

  // Agent-framework tool manifests: copy-paste tool definitions so an LLM
  // agent (OpenAI functions, MCP tool routers, LangChain-style wiring) can
  // call the free surfaces without hand-writing schemas.
  app.get('/.well-known/openai-tools.json', async (_req, reply) => {
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('cache-control', 'public, max-age=300');
    return reply.send(openaiTools(config));
  });

  app.get('/.well-known/mcp-tools.json', async (_req, reply) => {
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('cache-control', 'public, max-age=300');
    return reply.send(mcpTools(config));
  });

  // 402index domain-ownership proof: the SHA-256 of the registry's claim token,
  // served verbatim (no redirect, well under 1KB) at the exact URL it fetches.
  // Registered only while a claim is in progress (hash configured), so an
  // unconfigured deployment cleanly 404s.
  const indexVerifyHash = (config.indexVerifyHash ?? '').trim();
  if (indexVerifyHash !== '') {
    app.get('/.well-known/402index-verify.txt', async (_req, reply) => {
      reply.header('content-type', 'text/plain; charset=utf-8');
      reply.header('cache-control', 'no-store');
      return reply.send(indexVerifyHash);
    });
  }

  // RFC 9116 contact point for security researchers (probed by trust crawlers).
  app.get('/.well-known/security.txt', async (_req, reply) => {
    const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    reply.header('content-type', 'text/plain; charset=utf-8');
    reply.header('cache-control', 'public, max-age=86400');
    return reply.send(
      `Contact: https://github.com/shoutsid-lab/webcap/security/advisories/new\nExpires: ${expires}\nPreferred-Languages: en\n`,
    );
  });

  // Public trust page: live revenue stats + prices + merchant wallet.
  app.get('/transparency', async (_req, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8');
    reply.header('cache-control', 'public, max-age=300');
    return reply.send(transparencyHtml(config, transparencyStats(deps)));
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

// Live numbers for GET /transparency. Aggregate queries are best-effort:
// unknown tables (older DBs) degrade to zeros rather than failing the page.
function transparencyStats(deps: AppDeps): TransparencyStats {
  const { config } = deps;
  let paidCalls = 0;
  let revenueUnits = 0;
  let challengesServed = 0;
  try {
    const row = deps.db.prepare('SELECT COUNT(*) c, COALESCE(SUM(revenue_usdc),0) s FROM revenue_ledger').get() as {
      c: number;
      s: number;
    };
    paidCalls = row.c;
    revenueUnits = row.s;
  } catch {
    paidCalls = 0;
    revenueUnits = 0;
  }
  try {
    const row = deps.db.prepare('SELECT COUNT(*) c FROM endpoint_hits WHERE status = 402').get() as { c: number };
    challengesServed = row.c;
  } catch {
    challengesServed = 0;
  }
  const usdc = (units: number): string => {
    const whole = Math.trunc(units / USDC_SCALE);
    const frac = String(units % USDC_SCALE).padStart(6, '0').replace(/0+$/, '');
    return frac === '' ? String(whole) : `${whole}.${frac}`;
  };
  return {
    paidCalls,
    revenueUsdc: usdc(revenueUnits),
    challengesServed,
    chainName: config.chain.name,
    merchant: config.x402PayTo,
    prices: [
      { label: 'capture (screenshot + OG metadata)', path: 'POST /v1/x402/capture', usdc: usdc(config.x402PriceUsdcUnits) },
      { label: 'extract (structured content)', path: 'POST /v1/x402/extract', usdc: usdc(config.x402ExtractPriceUsdcUnits) },
      { label: 'audit (SEO + link/OG health)', path: 'POST /v1/x402/audit', usdc: usdc(config.x402AuditPriceUsdcUnits) },
      { label: 'map-lite (single-URL site map)', path: 'POST /v1/x402/map-lite', usdc: usdc(config.x402AuditPriceUsdcUnits) },
      { label: 'video (scroll-capture)', path: 'POST /v1/x402/video', usdc: usdc(config.x402VideoPriceUsdcUnits) },
      { label: 'analyze (AI visual analysis)', path: 'POST /v1/x402/analyze', usdc: usdc(config.x402ExtractPriceUsdcUnits) },
    ],
  };
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
