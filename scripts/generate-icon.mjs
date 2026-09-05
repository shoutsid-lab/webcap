// Generates public/icon.png — the webcap service icon served at GET /icon.png
// (referenced by the x402 bazaar resource.iconUrl). Dependency-free: hand-rolled
// PNG encoder (node:zlib deflate of filter-byte-0 scanlines + manual CRC32) so the
// committed byte stream is deterministic.
//
// Design: 256x256 RGBA; #4F46E5 rounded square (corner radius 56, transparent
// outside) with a white annulus "lens" (center (128,140), outer r 62, inner r 40)
// and a small white specular dot (r 9) at (154,116). 2x2 supersampling per pixel.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 256;
const CORNER_RADIUS = 56;
const BG = [0x4f, 0x46, 0xe5];
const LENS_CENTER = [128, 140];
const LENS_OUTER = 62;
const LENS_INNER = 40;
const DOT_CENTER = [154, 116];
const DOT_RADIUS = 9;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBytes = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

function insideRoundedSquare(px, py) {
  const clampedX = Math.min(Math.max(px, CORNER_RADIUS), SIZE - CORNER_RADIUS);
  const clampedY = Math.min(Math.max(py, CORNER_RADIUS), SIZE - CORNER_RADIUS);
  const dx = px - clampedX;
  const dy = py - clampedY;
  return dx * dx + dy * dy <= CORNER_RADIUS * CORNER_RADIUS;
}

function insideAnnulus(px, py) {
  const dx = px - LENS_CENTER[0];
  const dy = py - LENS_CENTER[1];
  const d2 = dx * dx + dy * dy;
  return d2 >= LENS_INNER * LENS_INNER && d2 <= LENS_OUTER * LENS_OUTER;
}

function insideDot(px, py) {
  const dx = px - DOT_CENTER[0];
  const dy = py - DOT_CENTER[1];
  return dx * dx + dy * dy <= DOT_RADIUS * DOT_RADIUS;
}

// 2x2 supersampled coverage in [0, 1]; deterministic (no randomness, no timestamps).
function coverage(px, py, inside) {
  let hits = 0;
  for (const ox of [0.25, 0.75]) {
    for (const oy of [0.25, 0.75]) {
      if (inside(px + ox, py + oy)) hits += 1;
    }
  }
  return hits / 4;
}

function renderRaw() {
  const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
  let offset = 0;
  for (let y = 0; y < SIZE; y += 1) {
    raw[offset] = 0; // PNG filter type 0 (None) per scanline
    offset += 1;
    for (let x = 0; x < SIZE; x += 1) {
      const square = coverage(x, y, insideRoundedSquare);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      if (square > 0) {
        const white = Math.max(coverage(x, y, insideAnnulus), coverage(x, y, insideDot));
        r = Math.round(BG[0] + (255 - BG[0]) * white);
        g = Math.round(BG[1] + (255 - BG[1]) * white);
        b = Math.round(BG[2] + (255 - BG[2]) * white);
        a = Math.round(square * 255);
      }
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
      offset += 4;
    }
  }
  return raw;
}

function encodePng(raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0); // width
  ihdr.writeUInt32BE(SIZE, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: truecolor with alpha (RGBA)
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter: adaptive
  ihdr[12] = 0; // interlace: none
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icon.png');
mkdirSync(dirname(outPath), { recursive: true });
const png = encodePng(renderRaw());
writeFileSync(outPath, png);
console.log(`wrote ${outPath} (${png.length} bytes, ${SIZE}x${SIZE} RGBA)`);
