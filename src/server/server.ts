import Fastify, { type FastifyInstance } from 'fastify';
import type { FacilitatorClient } from '@x402/core/server';
import type { Db } from '../db/index.js';
import type { ArtifactRepo } from '../db/artifacts.js';
import type { WebcapConfig } from '../config.js';
import { toResponse, type ErrorBody, HttpError } from '../util/errors.js';
import type { CaptureRequest, CaptureResult, StructuredCapture } from '../capture/pipeline.js';
import type { OgResult } from '../capture/og.js';
import { registerRoutes } from './routes.js';
import { registerWatchRoutes } from './watches.js';
import { registerX402Middleware } from './x402.js';

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
}

/** Build the webcap Fastify app with routes and the central error mapping. */
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
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
  registerRoutes(app, deps);
  registerWatchRoutes(app, deps);
  return app;
}

function fastifyStatus(err: unknown): number {
  if (typeof err === 'object' && err !== null && 'statusCode' in err) {
    const statusCode = (err as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 600) return statusCode;
  }
  return 500;
}
