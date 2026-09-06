import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApiFixture, makeApiFixture, type ApiFixture } from './fixture.js';
import { defaultLoggingOptions } from '../../src/server/logging.js';

interface LogLine {
  readonly level?: number;
  readonly msg?: string;
  readonly reqId?: string;
  readonly req?: { method?: string; url?: string; headers?: Record<string, string | string[] | undefined> };
  readonly res?: { statusCode?: number };
}

const UNKNOWN = '/v1/definitely-not-a-route';

describe('structured request logging (Fastify pino)', () => {
  let fx: ApiFixture;
  const lines: string[] = [];

  beforeAll(() => {
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    fx = makeApiFixture({ loggerOptions: { ...defaultLoggingOptions(), stream } });
  });

  afterAll(async () => {
    await closeApiFixture(fx);
  });

  const parsed = (): LogLine[] => lines.map((line) => JSON.parse(line) as LogLine);

  it('logs a 404 request line with a request id and the path', async () => {
    lines.length = 0;
    const res = await fx.app.inject({ method: 'GET', url: UNKNOWN });
    expect(res.statusCode).toBe(404);
    const reqLines = parsed().filter((line) => line.req?.url === UNKNOWN);
    expect(reqLines.length).toBeGreaterThan(0);
    for (const line of reqLines) {
      expect(line.reqId).toBeTypeOf('string');
      expect(line.reqId).not.toBe('');
      expect(line.req?.method).toBe('GET');
    }
  });

  it('redacts the authorization and payment headers from every captured line', async () => {
    lines.length = 0;
    await fx.app.inject({
      method: 'POST',
      url: UNKNOWN,
      headers: {
        authorization: 'Bearer SECRET_AUTH_VALUE_DO_NOT_LOG',
        'payment-signature': 'SECRET_PAYMENT_SIGNATURE_DO_NOT_LOG',
        'payment-required': 'SECRET_PAYMENT_REQUIRED_DO_NOT_LOG',
      },
    });
    expect(lines.length).toBeGreaterThan(0);
    // the serializer must carry the headers so the redaction is not vacuous
    const withHeaders = parsed().filter((line) => line.req?.headers !== undefined);
    expect(withHeaders.length).toBeGreaterThan(0);
    for (const line of withHeaders) {
      expect(line.req?.headers?.['authorization']).toBe('[Redacted]');
      expect(line.req?.headers?.['payment-signature']).toBe('[Redacted]');
      expect(line.req?.headers?.['payment-required']).toBe('[Redacted]');
    }
    for (const raw of lines) {
      expect(raw).not.toContain('SECRET_AUTH_VALUE_DO_NOT_LOG');
      expect(raw).not.toContain('SECRET_PAYMENT_SIGNATURE_DO_NOT_LOG');
      expect(raw).not.toContain('SECRET_PAYMENT_REQUIRED_DO_NOT_LOG');
    }
  });

  it('emits no request log line for /v1/health', async () => {
    lines.length = 0;
    const loud = await fx.app.inject({ method: 'GET', url: UNKNOWN });
    expect(loud.statusCode).toBe(404);
    expect(lines.length).toBeGreaterThan(0); // sanity: request logging is on
    lines.length = 0;
    const res = await fx.app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(lines).toHaveLength(0);
  });

  it('logs a 4xx completion at warn level with the status code', async () => {
    lines.length = 0;
    const res = await fx.app.inject({ method: 'GET', url: UNKNOWN });
    expect(res.statusCode).toBe(404);
    const completed = parsed().filter((line) => line.msg === 'request completed' && line.res?.statusCode === 404);
    expect(completed.length).toBeGreaterThan(0);
    for (const line of completed) {
      expect(line.level).toBe(40); // pino warn
    }
  });
});
