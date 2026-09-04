import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from '../db/index.js';
import type { WebcapConfig } from '../config.js';
import { toResponse, type ErrorBody, HttpError } from '../util/errors.js';
import type { CaptureRequest, CaptureResult } from '../capture/pipeline.js';
import type { OgResult } from '../capture/og.js';
import { registerRoutes } from './routes.js';

export interface AppDeps {
  readonly db: Db;
  readonly config: WebcapConfig;
  readonly capture: (req: CaptureRequest) => Promise<CaptureResult>;
  readonly og: (req: { url: string }) => Promise<OgResult>;
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
  registerRoutes(app, deps);
  return app;
}

function fastifyStatus(err: unknown): number {
  if (typeof err === 'object' && err !== null && 'statusCode' in err) {
    const statusCode = (err as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 600) return statusCode;
  }
  return 500;
}
