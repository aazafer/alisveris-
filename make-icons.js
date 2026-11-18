/* PWA ikonlarını bağımlılık olmadan üretir: node tools/make-icons.js */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 1024;
const S = SIZE / 512;
const px = (x) => Math.round(x * S);

function blank(n) { return Buffer.alloc(n * n * 4); }

function set(buf, n, x, y, c) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= n || y >= n) return;
  const i = (y * n + x) * 4;
  buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = c[3] ?? 255;
}

function roundRect(buf, n, x, y, w, h, r, c) {
  const x0 = Math.floor(x), x1 = Math.ceil(x + w);
  const y0 = Math.floor(y), y1 = Math.ceil(y + h);
  for (let py = y0; py < y1; py++) {
    for (let pxx = x0; pxx < x1; pxx++) {
      const dx = Math.max(x + r - pxx, 0, pxx - (x + w - r));
      const dy = Math.max(y + r - py, 0, py - (y + h - r));
      if (dx * dx + dy * dy <= r * r) set(buf, n, pxx, py, c);
    }
  }
}

function arcStroke(buf, n, cx, cy, r, a0, a1, thickness, c) {
  const t = thickness / 2;
  for (let y = Math.floor(cy - r - t); y <= Math.ceil(cy + r + t); y++) {
    for (let x = Math.floor(cx - r - t); x <= Math.ceil(cx + r + t); x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d < r - t || d > r + t) continue;
      let a = Math.atan2(y - cy, x - cx);
      if (a < 0) a += Math.PI * 2;
      if (a >= a0 && a <= a1) set(buf, n, x, y, c);
    }
  }
}

function lineStroke(buf, n, x1, y1, x2, y2, thickness, c) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = thickness / 2;
  const minX = Math.floor(Math.min(x1, x2) - t), maxX = Math.ceil(Math.max(x1, x2) + t);
  const minY = Math.floor(Math.min(y1, y2) - t), maxY = Math.ceil(Math.max(y1, y2) + t);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let u = ((x - x1) * dx + (y - y1) * dy) / len2;
      u = Math.max(0, Math.min(1, u));
      if (Math.hypot(x - (x1 + u * dx), y - (y1 + u * dy)) <= t) set(buf, n, x, y, c);
    }
  }
}

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

function draw() {
  const buf = blank(SIZE);
  const from = [37, 99, 235], to = [13, 148, 136];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const t = (x / SIZE + y / SIZE) / 2;
      set(buf, SIZE, x, y, [lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t), 255]);
    }
  }

  const white = [255, 255, 255, 255];
  const teal = [13, 148, 136, 255];

  // Çanta gövdesi
  roundRect(buf, SIZE, px(168), px(208), px(176), px(217), px(26), white);
  // Sap (üst yarım daire)
  arcStroke(buf, SIZE, px(256), px(214), px(56), Math.PI, Math.PI * 2, px(22), white);
  // Onay işareti
  lineStroke(buf, SIZE, px(216), px(306), px(246), px(336), px(24), teal);
  lineStroke(buf, SIZE, px(246), px(336), px(302), px(274), px(24), teal);

  return buf;
}

function downsample(src, n, m) {
  const out = blank(m);
  const scale = n / m;
  for (let y = 0; y < m; y++) {
    for (let x = 0; x < m; x++) {
      const x0 = Math.floor(x * scale), x1 = Math.min(n, Math.floor((x + 1) * scale));
      const y0 = Math.floor(y * scale), y1 = Math.min(n, Math.floor((y + 1) * scale));
      let r = 0, g = 0, b = 0, a = 0, count = 0;
      for (let py = y0; py < y1; py++) {
        for (let pxx = x0; pxx < x1; pxx++) {
          const i = (py * n + pxx) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; count++;
        }
      }
      const o = (y * m + x) * 4;
      out[o] = Math.round(r / count);
      out[o + 1] = Math.round(g / count);
      out[o + 2] = Math.round(b / count);
      out[o + 3] = Math.round(a / count);
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const name = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([len, name, data, crc]);
}

function png(buf, size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    buf.copy(raw, row + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const master = draw();
const here = __dirname;
for (const size of [192, 512]) {
  const file = path.join(here, '..', `icon-${size}.png`);
  fs.writeFileSync(file, png(downsample(master, SIZE, size), size));
  console.log('yazıldı:', file);
}
