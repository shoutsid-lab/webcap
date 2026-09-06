import { LogController } from 'fastify';
import type { FastifyReply, FastifyRequest, FastifyServerOptions } from 'fastify';

/** Sensitive request-header paths censored from every log line. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'req.headers.payment-signature',
  'req.headers.payment-required',
] as const;

/** The object form of the Fastify `logger` option (the non-boolean member). */
export type WebcapLoggerOptions = Exclude<FastifyServerOptions['logger'], boolean>;

/**
 * Default pino options for the request logger. The req serializer carries
 * the full header set (Fastify's default omits headers) so the redaction is
 * real, and the redact paths censor the auth + cookie + x402 payment headers
 * that carry the login-macro secrets, session cookies, API key, and payment
 * payloads.
 */
export function defaultLoggingOptions(): WebcapLoggerOptions {
  return {
    level: 'info',
    redact: { paths: [...REDACT_PATHS], censor: '[Redacted]' },
    serializers: {
      req: (req: FastifyRequest) => ({
        method: req.method,
        url: req.url,
        host: req.headers.host,
        remoteAddress: req.ip,
        headers: req.headers,
      }),
    },
  };
}

/**
 * webcap log-controller policy layered on Fastify's:
 * - 4xx request completions log at warn (with the status code), not info;
 * - /v1/health (liveness probe) emits no request log lines.
 */
class WebcapLogController extends LogController {
  override requestCompleted(
    error: Error | null | undefined,
    request: FastifyRequest,
    reply: FastifyReply,
    metadata?: Record<string, unknown>,
  ): void {
    if (this.isLogDisabled(request)) return;
    if (error !== null && error !== undefined) {
      reply.log.error({ res: reply, err: error, responseTime: reply.elapsedTime }, 'request errored');
      return;
    }
    if (reply.statusCode >= 400 && reply.statusCode < 500) {
      reply.log.warn({ res: reply, responseTime: reply.elapsedTime }, 'request completed');
    } else {
      reply.log.info({ res: reply, responseTime: reply.elapsedTime }, 'request completed');
    }
  }
}

/** Build the webcap log controller (health silent, 4xx at warn). */
export function makeWebcapLogController(): WebcapLogController {
  return new WebcapLogController({
    disableRequestLogging: (req: FastifyRequest) => req.url === '/v1/health',
  });
}
