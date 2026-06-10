#!/usr/bin/env node
// Generates the FINITE app icons as PNGs with zero dependencies.
// Art: a ring of 52 dots (one year of weeks) — the spent weeks burn ember,
// the remaining ones wait in the dark — around a single point of light.
//
// Usage: node tools/make-icons.mjs   (writes into ../icons)

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'icons');

// ---------- minimal PNG encoder ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- tiny software rasterizer ----------
function makeImage(size) {
  return { size, px: Buffer.alloc(size * size * 4) };
}

function blend(img, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= img.size || y >= img.size || a <= 0) return;
  const i = (y * img.size + x) * 4;
  const ia = 1 - a;
  img.px[i] = Math.round(r * a + img.px[i] * ia);
  img.px[i + 1] = Math.round(g * a + img.px[i + 1] * ia);
  img.px[i + 2] = Math.round(b * a + img.px[i + 2] * ia);
  img.px[i + 3] = Math.min(255, Math.round(255 * a + img.px[i + 3] * ia));
}

function fillBackground(img) {
  const s = img.size, cx = s / 2, cy = s / 2;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4;
      // vertical fade from #11111a down to #06060a
      const t = y / s;
      let r = 17 - 11 * t, g = 17 - 11 * t, b = 26 - 16 * t;
      // faint warm glow pooling at the center
      const d = Math.hypot(x - cx, y - cy) / (s * 0.5);
      const glow = Math.exp(-(d * d) * 3.2) * 0.16;
      r += 255 * glow * 0.9;
      g += 140 * glow * 0.9;
      b += 40 * glow * 0.9;
      img.px[i] = Math.min(255, Math.round(r));
      img.px[i + 1] = Math.min(255, Math.round(g));
      img.px[i + 2] = Math.min(255, Math.round(b));
      img.px[i + 3] = 255;
    }
  }
}

function disc(img, cx, cy, radius, r, g, b, alpha = 1) {
  const x0 = Math.floor(cx - radius - 2), x1 = Math.ceil(cx + radius + 2);
  const y0 = Math.floor(cy - radius - 2), y1 = Math.ceil(cy + radius + 2);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const cov = Math.max(0, Math.min(1, radius - d + 0.5));
      if (cov > 0) blend(img, x, y, r, g, b, cov * alpha);
    }
  }
}

function glow(img, cx, cy, sigma, r, g, b, peak) {
  const reach = sigma * 3;
  const x0 = Math.floor(cx - reach), x1 = Math.ceil(cx + reach);
  const y0 = Math.floor(cy - reach), y1 = Math.ceil(cy + reach);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / sigma;
      const a = Math.exp(-d * d) * peak;
      if (a > 0.004) blend(img, x, y, r, g, b, a);
    }
  }
}

function lerp(a, b, t) { return a + (b - a) * t; }

// ---------- the FINITE mark ----------
function drawIcon(size, { safeZone = false } = {}) {
  const img = makeImage(size);
  fillBackground(img);
  const cx = size / 2, cy = size / 2;
  // maskable icons keep all art inside the inner 80% safe zone
  const R = size * (safeZone ? 0.295 : 0.36);
  const dotR = size * 0.0235;
  const DOTS = 52;
  const LIVED = 30; // ~58% of the year spent

  for (let i = 0; i < DOTS; i++) {
    const ang = -Math.PI / 2 + (i / DOTS) * Math.PI * 2; // start at 12 o'clock
    const x = cx + Math.cos(ang) * R;
    const y = cy + Math.sin(ang) * R;
    if (i < LIVED) {
      // spent weeks: ember gradient cooling along the arc
      const t = i / (LIVED - 1);
      const r = lerp(255, 255, t), g = lerp(214, 122, t), b = lerp(140, 26, t);
      glow(img, x, y, dotR * 1.9, r, g, b, 0.28);
      disc(img, x, y, dotR, r, g, b);
    } else if (i === LIVED) {
      // the current week: brightest, with a halo — "you are here"
      glow(img, x, y, dotR * 3.4, 255, 224, 178, 0.55);
      disc(img, x, y, dotR * 1.5, 255, 236, 204);
    } else {
      // weeks still in the dark
      disc(img, x, y, dotR * 0.82, 64, 64, 78);
    }
  }

  // the single point of light at the center: the present moment
  glow(img, cx, cy, size * 0.085, 255, 170, 70, 0.5);
  glow(img, cx, cy, size * 0.035, 255, 230, 200, 0.85);
  disc(img, cx, cy, size * 0.028, 255, 248, 240);

  return encodePNG(size, size, img.px);
}

fs.mkdirSync(OUT, { recursive: true });
const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['maskable-192.png', 192, { safeZone: true }],
  ['maskable-512.png', 512, { safeZone: true }],
  ['apple-touch-icon.png', 180, { safeZone: true }],
];
for (const [name, size, opts] of targets) {
  fs.writeFileSync(path.join(OUT, name), drawIcon(size, opts));
  console.log('wrote icons/' + name);
}
