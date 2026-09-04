import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { CaptureError } from '../../src/capture/errors.js';
import { closeBrowser } from '../../src/capture/browser.js';
import { capture } from '../../src/capture/pipeline.js';
import { ogMetadata } from '../../src/capture/og.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const PAGE_HTML = `<!doctype html>
<html>
  <head>
    <title>Webcap Fixture Page</title>
    <meta property="og:title" content="OG Title Here" />
    <meta property="og:description" content="OG Description Here" />
    <meta property="og:image" content="/og.png" />
    <link rel="icon" href="/icon.png" />
  </head>
  <body><h1>Hello capture</h1><img src="/px.png" /></body>
</html>`;

const PLAIN_HTML = `<!doctype html><html><head><title>Plain Title</title></head><body>plain</body></html>`;

describe('capture pipeline (local http fixture, no internet)', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/og.png' || req.url === '/icon.png' || req.url === '/px.png') {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(ONE_PIXEL_PNG);
        return;
      }
      if (req.url === '/plain') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(PLAIN_HTML);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(PAGE_HTML);
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('fixture server has no port');
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    // server.close's callback receives no argument on success
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((err) => {
        if (err !== undefined) rejectClose(err);
        else resolveClose();
      });
    });
    await closeBrowser();
  });

  it('png capture returns a real PNG buffer', async () => {
    const result = await capture({ url: `${base}/` });
    expect(result.format).toBe('png');
    expect(result.bytes).toBe(result.buffer.length);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.buffer.subarray(0, 4).toString('hex')).toBe('89504e47');
  });

  it('jpeg capture returns a real JPEG buffer', async () => {
    const result = await capture({ url: `${base}/`, format: 'jpeg' });
    expect(result.format).toBe('jpeg');
    expect(result.buffer.subarray(0, 3).toString('hex')).toBe('ffd8ff');
  });

  it('pdf capture returns a real PDF buffer', async () => {
    const result = await capture({ url: `${base}/`, format: 'pdf' });
    expect(result.format).toBe('pdf');
    expect(result.buffer.subarray(0, 4).toString('utf8')).toBe('%PDF');
  });

  it('og metadata prefers og:title and extracts description, image, icon', async () => {
    const og = await ogMetadata({ url: `${base}/` });
    expect(og.url).toBe(`${base}/`);
    expect(og.title).toBe('OG Title Here');
    expect(og.description).toBe('OG Description Here');
    expect(og.image).toBe('/og.png');
    expect(og.icon).toBe('/icon.png');
  });

  it('og metadata falls back to <title> when og:title is absent', async () => {
    const og = await ogMetadata({ url: `${base}/plain` });
    expect(og.title).toBe('Plain Title');
    expect(og.description).toBeUndefined();
  });

  it('capture throws a typed CaptureError when the connection is refused', async () => {
    await expect(capture({ url: 'http://127.0.0.1:1/', options: { timeoutMs: 5_000 } })).rejects.toThrow(
      CaptureError,
    );
  });
});
