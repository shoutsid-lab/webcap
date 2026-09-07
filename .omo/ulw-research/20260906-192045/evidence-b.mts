/**
 * Wave-4 gate evidence Part B: S4 viewport PNG pair (real Chromium, local fixture, no internet).
 * Writes s4-viewport-default.png + s4-viewport-mobile.png + s4-viewport-dims.json to journal dir.
 */
import { createServer, type Server } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { capture } from '../../../src/capture/pipeline.js';
import { closeBrowser } from '../../../src/capture/browser.js';

const J = '/home/shoutsid/code/webcap/.omo/ulw-research/20260906-192045';
mkdirSync(J, { recursive: true });

const PAGE = `<!doctype html><html><head><title>S4 fixture</title></head><body style="margin:0"><h1>viewport proof</h1><div style="width:2000px;height:1200px;background:#eee">wide</div></body></html>`;

function pngDims(buf: Buffer): { width: number; height: number } {
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('not a PNG');
  // IHDR chunk: width/height are big-endian u32 at offsets 16/20
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function main(): Promise<void> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no port');
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    const def = await capture({ url: `${base}/` });
    const mob = await capture({
      url: `${base}/`,
      options: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true },
    });
    writeFileSync(join(J, 's4-viewport-default.png'), def.buffer);
    writeFileSync(join(J, 's4-viewport-mobile.png'), mob.buffer);
    const dd = pngDims(def.buffer);
    const dm = pngDims(mob.buffer);
    const summary = {
      default: { format: def.format, bytes: def.bytes, ...dd },
      mobile: { format: mob.format, bytes: mob.bytes, ...dm },
      dimsDiffer: dd.width !== dm.width || dd.height !== dm.height,
      mobileMatchesCssViewportAtDsf2: dm.width === 390 * 2 && dm.height === 844 * 2,
    };
    writeFileSync(join(J, 's4-viewport-dims.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e !== undefined ? reject(e) : resolve())));
    await closeBrowser();
  }
}

void main();
