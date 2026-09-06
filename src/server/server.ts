import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import type { FacilitatorClient } from '@x402/core/server';
import type { Db } from '../db/index.js';
import type { ArtifactRepo } from '../db/artifacts.js';
import { DEFAULT_BODY_LIMIT_BYTES, DEFAULT_REQUEST_TIMEOUT_MS, type WebcapConfig } from '../config.js';
import { toResponse, type ErrorBody, HttpError } from '../util/errors.js';
import type { CaptureRequest, CaptureResult, StructuredCapture } from '../capture/pipeline.js';
import type { OgResult } from '../capture/og.js';
import { registerBillingRoutes } from './billing.js';
import { registerAdminHitsRoutes } from './admin-hits.js';
import { registerMapLiteRoute } from './map-lite.js';
import { registerVideoRoute } from './video.js';
import { registerJobRoutes } from './jobs.js';
import { registerRoutes } from './routes.js';
import { registerDiscoveryRoutes } from './discovery.js';
import { registerAgentSurfaces } from './agent-surfaces.js';
import { registerWatchRoutes } from './watches.js';
import { registerX402Middleware } from './x402.js';
import { registerMppChallengeHook } from '../mpp/plugin.js';
import { registerHitsHook } from '../db/hits.js';
import { makeWebcapLogController } from './logging.js';

export interface AppDeps {
  readonly db: Db;
  readonly artifacts: ArtifactRepo;
  readonly config: WebcapConfig;
  readonly capture: (req: CaptureRequest) => Promise<CaptureResult>;
  readonly captureStructured: (req: CaptureRequest) => Promise<StructuredCapture>;
  readonly og: (req: { url: string }) => Promise<OgResult>;
  /** Private hosts that may still be captured (local dev); default: none. */
  readonly captureAllowHosts?: readonly string[];
  /** x402 verify/settle client; required when config.x402Network is set. */
  readonly x402Facilitator?: FacilitatorClient;
  /** Background runner for async capture jobs; T2-C routes invoke it after enqueue. */
  readonly captureJobRunner?: (jobId: string) => Promise<void>;
  /** Optional shared secret for async capture job callbacks. */
  readonly jobSecret?: string;
  /** Pino options for the request logger (default: logging disabled). */
  readonly loggerOptions?: FastifyServerOptions['logger'];
}

/** Build the webcap Fastify app with routes and the central error mapping. */
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.loggerOptions ?? false,
    logController: makeWebcapLogController(),
    requestTimeout: deps.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    bodyLimit: deps.config.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES,
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      const response = toResponse(err);
      void reply.status(response.status).send(response.body satisfies ErrorBody);
      return;
    }
    const status = fastifyStatus(err);
    const body: ErrorBody =
      status === 500
        ? { error: { code: 'internal', message: 'internal server error' } }
        : { error: { code: 'bad_request', message: 'malformed request' } };
    void reply.status(status).send(body);
  });
  // Payment hooks must be installed before routes so onRequest/onSend/onError
  // cover the gated /v1/x402/capture + /v1/x402/watches/topup handlers.
  registerX402Middleware(app, deps.config, deps.x402Facilitator, deps.db);
  registerMppChallengeHook(app, deps.config, deps.db);
  // After the x402 hooks on purpose: the x402 402 challenge must win for the
  // GET /v1/x402/* discovery paths, which register no GET route of their own.
  registerNotFoundEnvelope(app);
  // The credits-rail routes used to be the first half of registerRoutes;
  // keeping them ahead of it preserves the original registration order (all
  // paths are unique, so the router is order-independent — but the x402
  // hooks above must still precede every route registration).
  registerBillingRoutes(app, deps);
  registerAdminHitsRoutes(app, deps);
  registerRoutes(app, deps);
  registerJobRoutes(app, deps);
  registerMapLiteRoute(app, { db: deps.db, config: deps.config, captureAllowHosts: deps.captureAllowHosts });
  registerVideoRoute(app, { db: deps.db, config: deps.config, captureAllowHosts: deps.captureAllowHosts });
  registerDiscoveryRoutes(app, deps);
  registerAgentSurfaces(app, deps.config);
  registerWatchRoutes(app, deps);
  // Metrics write path (additive, zero-risk): onResponse hit rows carry only
  // the hashed payer; a throwing write never 500s a paid request.
  registerHitsHook(app, deps.db);
  return app;
}

function fastifyStatus(err: unknown): number {
  if (typeof err === 'object' && err !== null && 'statusCode' in err) {
    const statusCode = (err as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 600) return statusCode;
  }
  return 500;
}

/** Canonical method order for the Allow header of a 405 response. */
const ALLOW_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'TRACE'] as const;

/**
 * Envelope responses for unmatched requests. Fastify 5 deliberately has no
 * native 405 (fastify/fastify#862): a wrong method on a known path lands in
 * the not-found handler, so the router is probed to tell the two cases apart.
 *
 * The decision must also run in onRequest, because the not-found handler is
 * only reached after Fastify's content-type parser has run in the 404 context:
 * a body-carrying verb (DELETE/PUT/PATCH) with `Content-Type: application/json`
 * and an empty body would otherwise fail body parsing (400 "malformed request")
 * before any 405 could be sent.
 */
function registerNotFoundEnvelope(app: FastifyInstance): void {
  // Async on purpose: a sync onRequest hook must call done() itself, and the
  // matched-route early-return would stall the request pipeline without it.
  app.addHook('onRequest', async (req, reply) => {
    if (app.findRoute({ method: req.method, url: req.url }) !== null) return;
    replyNotFoundOrMethodNotAllowed(app, req, reply);
  });
  app.setNotFoundHandler((req, reply) => replyNotFoundOrMethodNotAllowed(app, req, reply));
}

function replyNotFoundOrMethodNotAllowed(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply): void {
  const allowed = ALLOW_METHODS.filter((method) => app.findRoute({ method, url: req.url }) !== null);
  if (allowed.length > 0) {
    reply.header('allow', allowed.join(', '));
    const body: ErrorBody = { error: { code: 'method_not_allowed', message: 'method not allowed' } };
    void reply.status(405).send(body);
    return;
  }
  const body: ErrorBody = { error: { code: 'not_found', message: 'route not found' } };
  void reply.status(404).send(body);
}
