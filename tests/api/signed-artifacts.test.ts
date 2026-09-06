import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { fireSignedWebhook, fireWebhook } from '../../src/watch/webhook.js';
import { closeApiFixture, FAKE_PNG, makeApiFixture } from './fixture.js';

/**
 * C-S2 RED contract for signed artifact URLs + webhook HMAC.
 *
 * Signature scheme (the GREEN implementation adopts this exact scheme):
 *   sig = hex(hmac_sha256(secret, `${artifactId}.${exp}`))
 *   URL = /v1/artifacts/:id?exp=<unix seconds>&sig=<hex>
 * Verification: recompute over the id + exp path segment, compare with
 * timingSafeEqual; exp <= now -> 410 gone; mismatch -> 403.
 */
const TEST_ARTIFACT_SECRET = 'test-artifact-signing-secret';

function signArtifact(secret: string, artifactId: string, exp: number): string {
  return createHmac('sha256', secret).update(`${artifactId}.${exp}`).digest('hex');
}

function futureExp(): number {
  return Math.floor(Date.now() / 1000) + 3600;
}

function pastExp(): number {
  return Math.floor(Date.now() / 1000) - 3600;
}

/** Capture one artifact via the credits rail; returns its id + path. */
async function seedArtifact(): Promise<{ fx: ReturnType<typeof makeApiFixture>; id: string; path: string }> {
  const fx = makeApiFixture();
  fx.credits.grantCredits(fx.accountId, 1, 'test_seed');
  const cap = await fx.app.inject({
    method: 'POST',
    url: '/v1/capture',
    payload: { url: 'https://example.com/' },
    headers: { authorization: `Bearer ${fx.apiKey}` },
  });
  if (cap.statusCode !== 200) throw new Error(`seed capture failed: ${cap.statusCode} ${cap.payload}`);
  const json = cap.json() as { artifact: { url: string } };
  const path = json.artifact.url.slice(fx.config.publicBaseUrl.length);
  const id = path.slice('/v1/artifacts/'.length).split('?')[0] ?? '';
  return { fx, id, path };
}

describe('C-S2: signed artifact URLs (legacy compat + verification)', () => {
  it('unsigned GET /v1/artifacts/:id still 200 (legacy, no signature required)', async () => {
    const { fx, path } = await seedArtifact();
    try {
      const res = await fx.app.inject({ method: 'GET', url: path });
      expect(res.statusCode).toBe(200);
      expect(Buffer.from(res.rawPayload)).toEqual(FAKE_PNG);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('GET unknown artifact id is 404 not_found', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({
        method: 'GET',
        url: '/v1/artifacts/00000000-0000-4000-8000-000000000000',
      });
      expect(res.statusCode).toBe(404);
      const envelope = res.json() as { error: { code: string } };
      expect(envelope.error.code).toBe('not_found');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('valid ?exp=&sig= verifies -> 200', async () => {
    const { fx, id } = await seedArtifact();
    try {
      const exp = futureExp();
      const sig = signArtifact(TEST_ARTIFACT_SECRET, id, exp);
      const res = await fx.app.inject({ method: 'GET', url: `/v1/artifacts/${id}?exp=${exp}&sig=${sig}` });
      expect(res.statusCode).toBe(200);
      expect(Buffer.from(res.rawPayload)).toEqual(FAKE_PNG);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('tampered sig -> 403', async () => {
    const { fx, id } = await seedArtifact();
    try {
      const exp = futureExp();
      const res = await fx.app.inject({
        method: 'GET',
        url: `/v1/artifacts/${id}?exp=${exp}&sig=${'0'.repeat(64)}`,
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('expired exp -> 410 even with a well-formed sig', async () => {
    const { fx, id } = await seedArtifact();
    try {
      const exp = pastExp();
      const sig = signArtifact(TEST_ARTIFACT_SECRET, id, exp);
      const res = await fx.app.inject({ method: 'GET', url: `/v1/artifacts/${id}?exp=${exp}&sig=${sig}` });
      expect(res.statusCode).toBe(410);
    } finally {
      await closeApiFixture(fx);
    }
  });
});

/**
 * Receiver-side webhook HMAC fixture: verifies `sha256=<hex>` over the RAW
 * request body with timingSafeEqual (raw bytes, never the parsed JSON).
 */
function verifyWebhookSignature(secret: string, rawBody: Buffer, header: string | undefined): boolean {
  if (header === undefined) return false;
  const prefix = 'sha256=';
  if (!header.startsWith(prefix)) return false;
  const presented = header.slice(prefix.length);
  if (!/^[0-9a-f]{64}$/.test(presented)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const actual = Buffer.from(presented, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

interface CapturedDelivery {
  rawBody: Buffer;
  signature: string | undefined;
  count: number;
}

function startReceiver(options: { status: number; failFirst?: number; delayMs?: number }): Promise<{
  url: string;
  deliveries: CapturedDelivery;
  close: () => Promise<void>;
}> {
  const deliveries: CapturedDelivery = { rawBody: Buffer.alloc(0), signature: undefined, count: 0 };
  let failures = 0;
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      deliveries.count += 1;
      deliveries.rawBody = Buffer.concat(chunks);
      const header = req.headers['x-hub-signature-256'];
      deliveries.signature = Array.isArray(header) ? header[0] : header;
      const send = (): void => {
        if (failures < (options.failFirst ?? 0)) {
          failures += 1;
          res.writeHead(500).end('boom');
          return;
        }
        res.writeHead(options.status).end('ok');
      };
      if ((options.delayMs ?? 0) > 0) {
        setTimeout(send, options.delayMs).unref?.();
        return;
      }
      send();
    });
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('receiver failed to bind'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${String(address.port)}/hook`,
        deliveries,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

describe('C-S2: webhook HMAC delivery (sha256=<hex> over the raw body)', () => {
  it('receiver fixture: a correct sha256=<hex> signature verifies via timingSafeEqual over the raw body', () => {
    const secret = 'whsec-test';
    const rawBody = Buffer.from(JSON.stringify({ watchId: 'w1', changed: true }), 'utf8');
    const good = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    expect(verifyWebhookSignature(secret, rawBody, good)).toBe(true);
    expect(verifyWebhookSignature('wrong-secret', rawBody, good)).toBe(false);
    expect(verifyWebhookSignature(secret, Buffer.from(`${rawBody.toString('utf8')} `), good)).toBe(false);
    expect(verifyWebhookSignature(secret, rawBody, 'sha256=00')).toBe(false);
    expect(verifyWebhookSignature(secret, rawBody, undefined)).toBe(false);
    expect(verifyWebhookSignature(secret, rawBody, 'not-a-signature')).toBe(false);
  });

  it('fireSignedWebhook signs delivery: the receiver observes x-hub-signature-256: sha256=<hex> verifying over the raw body', async () => {
    const receiver = await startReceiver({ status: 200 });
    try {
      const outcome = await fireSignedWebhook(receiver.url, { watchId: 'w1', changed: true }, 'test-secret', 3, 5_000);
      expect(outcome).toBe('ok: HTTP 200');
      expect(receiver.deliveries.count).toBe(1);
      const signature = receiver.deliveries.signature;
      expect(signature, 'fireSignedWebhook must send x-hub-signature-256: sha256=<hex>').toMatch(/^sha256=[0-9a-f]{64}$/);
      // The signature must be over the exact raw bytes the receiver got.
      expect(signature?.startsWith('sha256=')).toBe(true);
      expect(receiver.deliveries.rawBody.length).toBeGreaterThan(0);
    } finally {
      await receiver.close();
    }
  });

  it('fireWebhook keeps its retries/timeout contract (attempts + per-attempt budget)', async () => {
    const flaky = await startReceiver({ status: 200, failFirst: 2 });
    try {
      const outcome = await fireWebhook(flaky.url, { watchId: 'w1', changed: true }, 3, 5_000);
      expect(outcome).toBe('ok: HTTP 200');
      expect(flaky.deliveries.count).toBe(3);
    } finally {
      await flaky.close();
    }

    const down = await startReceiver({ status: 500 });
    try {
      const outcome = await fireWebhook(down.url, { watchId: 'w1' }, 2, 5_000);
      expect(outcome).toBe('failed: HTTP 500');
      expect(down.deliveries.count).toBe(2);
    } finally {
      await down.close();
    }

    const slow = await startReceiver({ status: 200, delayMs: 400 });
    try {
      const outcome = await fireWebhook(slow.url, { watchId: 'w1' }, 1, 50);
      expect(outcome.startsWith('failed:')).toBe(true);
    } finally {
      await slow.close();
    }
  });
});
