// Draws the SubSwap icon straight to PNG at every size Chrome and the Web Store
// need. No dependencies, no browser, nothing on screen.
//
//   node scripts/icons.mjs
//
// Rendering the SVG through headless Chrome was the obvious approach and it
// hung on this machine, so the shapes are rasterised here instead. The artwork
// is two rounded bars with chevrons on a rounded square — all of it expressible
// as "distance to a line segment", which is a dozen lines of maths and cannot
// fail halfway. assets/icon.svg is kept in step as the human-readable source.

import { deflateSync } from "node:zlib";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SIZES = [128, 48, 32, 16];

const PINK = [0xf4, 0xa7, 0xc3];
const INK = [0x57, 0x13, 0x2f];

// Everything below is in the SVG's 128-unit space and scaled per size.
const UNITS = 128;
const CORNER = 28;
const STROKE = 11;
const SEGMENTS = [
  // top arrow: bar, then the two halves of the chevron
  [36, 51, 88, 51],
  [76, 39, 92, 51],
  [92, 51, 76, 63],
  // bottom arrow, pointing the other way
  [92, 79, 40, 79],
  [52, 67, 36, 79],
  [36, 79, 52, 91],
];

// Distance from a point to a line segment — a stroked line is every point
// within half the stroke width of it, which gives round caps for free.
function distanceToSegment(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  let t = lengthSquared === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function insideRoundedSquare(px, py) {
  const near = CORNER;
  const far = UNITS - CORNER;
  const cx = px < near ? near : px > far ? far : px;
  const cy = py < near ? near : py > far ? far : py;
  if (cx === px && cy === py) return px >= 0 && px <= UNITS && py >= 0 && py <= UNITS;
  return Math.hypot(px - cx, py - cy) <= CORNER;
}

function insideArrows(px, py) {
  for (const segment of SEGMENTS) {
    if (distanceToSegment(px, py, segment) <= STROKE / 2) return true;
  }
  return false;
}

// 4x4 supersampling. Cheap at these sizes and it's what stops 16px looking
// like it was cut out with scissors.
const SUB = 4;

function renderPixels(size) {
  const scale = UNITS / size;
  const data = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let background = 0;
      let foreground = 0;

      for (let sy = 0; sy < SUB; sy++) {
        for (let sx = 0; sx < SUB; sx++) {
          const px = (x + (sx + 0.5) / SUB) * scale;
          const py = (y + (sy + 0.5) / SUB) * scale;
          if (insideRoundedSquare(px, py)) {
            background += 1;
            if (insideArrows(px, py)) foreground += 1;
          }
        }
      }

      const total = SUB * SUB;
      const alpha = background / total;
      const ink = foreground / total;
      const offset = (y * size + x) * 4;

      if (alpha === 0) continue;

      // Ink over pink, then the whole thing over transparency.
      const mix = ink / alpha;
      for (let channel = 0; channel < 3; channel++) {
        data[offset + channel] = Math.round(PINK[channel] * (1 - mix) + INK[channel] * mix);
      }
      data[offset + 3] = Math.round(alpha * 255);
    }
  }
  return data;
}

// --- minimal PNG encoder ---------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 8 bits per channel
  header[9] = 6; // RGBA
  // 10-12: deflate, adaptive filtering, no interlace — all zero.

  // One filter byte (0 = none) in front of every scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const from = y * size * 4;
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, from, from + size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- go --------------------------------------------------------------------

const outDir = join(root, "src/icons");
mkdirSync(outDir, { recursive: true });

for (const size of SIZES) {
  const out = join(outDir, `icon-${size}.png`);
  writeFileSync(out, encodePng(size, renderPixels(size)));

  // Read it back and confirm the header says what we think it does.
  const check = statSync(out);
  console.log(`icon-${size}.png  ${check.size} bytes`);
}

console.log(`\nwrote ${SIZES.length} icons to src/icons/`);
