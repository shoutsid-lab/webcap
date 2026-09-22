/**
 * Every paid path is served for GET as well as POST.
 *
 * The x402 middleware challenges both methods on a paid path, and an x402
 * client retries the method it was challenged on. A GET that reached no route
 * was answered 405 *after* the payer had signed — a dead end for a customer
 * that cannot reason its way out of a protocol mismatch.
 *
 * These run on the local-chain fixture (x402 disabled), so reaching the shared
 * handler is visible as its own `503 x402_disabled` guard rather than a 405: a
 * 405 here would mean the GET form is missing. The paid wire itself (signature,
 * settlement, artifact) is covered in tests/e2e/x402.get-form.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { closeApiFixture, errorEnvelope, makeApiFixture } from './fixture.js';

/** path -> query string carrying the parameters the POST body would have. */
const PAID_GET_FORMS: ReadonlyArray<readonly [string, string]> = [
  ['/v1/x402/capture', 'url=https://example.com/'],
  ['/v1/x402/extract', 'url=https://example.com/'],
  ['/v1/x402/audit', 'url=https://example.com/'],
  ['/v1/x402/map-lite', 'url=https://example.com/&maxUrls=5'],
  ['/v1/x402/video', 'url=https://example.com/'],
  ['/v1/x402/analyze', 'url=https://example.com/&task=classification'],
  ['/v1/x402/analyze/batch', `urls=${encodeURIComponent('["https://example.com/"]')}&task=classification`],
  ['/v1/x402/watches/topup', 'watchId=w1&runs=100'],
];

describe('paid routes accept GET with the parameters in the query string', () => {
  it('each paid path reaches its handler instead of 405', async () => {
    const fx = makeApiFixture();
    try {
      for (const [path, query] of PAID_GET_FORMS) {
        const res = await fx.app.inject({ method: 'GET', url: `${path}?${query}` });
        expect(res.statusCode, `GET ${path} should reach the handler`).not.toBe(405);
        // With x402 off (local chain) the handler's own guard is reached first,
        // which is the proof the GET form shares the POST handler.
        expect(errorEnvelope(res).code, `GET ${path}`).toBe('x402_disabled');
      }
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('a GET answers exactly what the equivalent POST answers', async () => {
    const fx = makeApiFixture();
    try {
      for (const [path, query] of PAID_GET_FORMS) {
        const body = Object.fromEntries(new URLSearchParams(query).entries());
        const posted = await fx.app.inject({ method: 'POST', url: path, payload: body });
        const fetched = await fx.app.inject({ method: 'GET', url: `${path}?${query}` });
        expect(fetched.statusCode, `GET vs POST ${path}`).toBe(posted.statusCode);
        expect(errorEnvelope(fetched).code, `GET vs POST ${path}`).toBe(errorEnvelope(posted).code);
      }
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('HEAD is not served on a paid path (it would bypass the challenge)', async () => {
    const fx = makeApiFixture();
    try {
      for (const [path] of PAID_GET_FORMS) {
        const res = await fx.app.inject({ method: 'HEAD', url: path });
        expect(res.statusCode, `HEAD ${path}`).toBe(405);
        expect(String(res.headers['allow']), `HEAD ${path}`).toBe('GET, POST');
      }
    } finally {
      await closeApiFixture(fx);
    }
  });
});
