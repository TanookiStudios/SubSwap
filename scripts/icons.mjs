// Draws the SubSwap icon straight to PNG at every size Chrome and the Web Store
// need. No dependencies, no browser, nothing on screen.
//
//   node scripts/icons.mjs
//
// Rendering assets/icon.svg through headless Chrome was the obvious approach
// and it hung on this machine, so the shapes are rasterised here instead —
// everything in the mark is "distance to a line segment", which is a dozen
// lines of maths and cannot fail halfway. assets/icon.svg is the readable copy
// of the same geometry; change one, change the other.
//
// The mark: a list of channels lifting off one account and landing on another.
// Solid bars are what you have, outlined bars are where they're going, and the
// arrow carries them across.

import { deflateSync } from "node:zlib";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SIZES = [128, 48, 32, 16];

const BG = [0x10, 0x10, 0x14];
const INK = [0xff, 0xff, 0xff];

// Everything below is in the SVG's 128-unit space and scaled per size.
const UNITS = 128;
const CORNER = 28;

// Two geometries, because a shrunk icon is not a small icon. The full mark has
// three rows a side; at 16px those six bars plus an arrow turn into a grey
// smudge, so the small mark drops to two rows, thickens everything, and widens
// the gap between the columns. Same idea, fewer things to resolve.
const FULL = {
  barR: 5.5,
  rows: [64, 82, 100],
  left: [27.5, 50.5],
  right: [77.5, 100.5],
  outlineT: 4.6,
  arrowR: 5,
  curve: [[28, 48], [64, 20], [100, 48]],
  outlined: true,
};

const SMALL = {
  barR: 8.5,
  rows: [74, 100],
  left: [30, 50],
  right: [82, 102],
  outlineT: 7,
  arrowR: 7.5,
  curve: [[30, 46], [64, 22], [98, 46]],
  // An outline is under a pixel down here. The destination bars go solid but
  // dimmer instead — still reads as "not filled in yet", still visible.
  outlined: false,
};

// Below this the small mark is used.
const SMALL_MAX_SIZE = 32;
const DIM = 0.58;

// Stop the curve short of the head so the two don't bulge where they meet.
const ARROW_CURVE_END = 0.86;

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  let t = lengthSquared === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function distanceToPolyline(px, py, points) {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const d = distanceToSegment(px, py, points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]);
    if (d < best) best = d;
  }
  return best;
}

// Flatten the curve and derive the head from its own end tangent, so a variant
// only has to state its curve and thickness and the arrow stays consistent.
function buildArrow(variant) {
  const [p0, p1, p2] = variant.curve;
  const points = [];
  const STEPS = 28;
  for (let i = 0; i <= STEPS; i++) {
    const t = (i / STEPS) * ARROW_CURVE_END;
    const u = 1 - t;
    points.push([
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    ]);
  }

  const tx = 2 * (p2[0] - p1[0]);
  const ty = 2 * (p2[1] - p1[1]);
  const len = Math.hypot(tx, ty);
  const ux = tx / len;
  const uy = ty / len;

  const tip = [p2[0] + ux * variant.arrowR * 0.9, p2[1] + uy * variant.arrowR * 0.9];
  const headLen = variant.arrowR * 3.6;
  const halfWidth = variant.arrowR * 2.3;
  const back = [tip[0] - ux * headLen, tip[1] - uy * headLen];
  const head = [
    [back[0] - uy * halfWidth, back[1] + ux * halfWidth],
    [back[0] + uy * halfWidth, back[1] - ux * halfWidth],
    tip,
  ];

  return { points, head };
}

const ARROWS = new Map([
  [FULL, buildArrow(FULL)],
  [SMALL, buildArrow(SMALL)],
]);

// Standard half-plane test: inside if it's on the same side of all three edges.
function insideTriangle(px, py, tri) {
  let positive = false;
  let negative = false;
  for (let i = 0; i < 3; i++) {
    const [ax, ay] = tri[i];
    const [bx, by] = tri[(i + 1) % 3];
    const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    if (cross > 0) positive = true;
    if (cross < 0) negative = true;
  }
  return !(positive && negative);
}

function insideRoundedSquare(px, py) {
  const near = CORNER;
  const far = UNITS - CORNER;
  const cx = px < near ? near : px > far ? far : px;
  const cy = py < near ? near : py > far ? far : py;
  if (cx === px && cy === py) return px >= 0 && px <= UNITS && py >= 0 && py <= UNITS;
  return Math.hypot(px - cx, py - cy) <= CORNER;
}

// How much ink is at this point: 1 = solid, DIM = the dimmed destination bars,
// 0 = background.
function inkAt(px, py, v) {
  const arrow = ARROWS.get(v);
  if (distanceToPolyline(px, py, arrow.points) <= v.arrowR) return 1;
  if (insideTriangle(px, py, arrow.head)) return 1;

  for (const cy of v.rows) {
    if (distanceToSegment(px, py, v.left[0], cy, v.left[1], cy) <= v.barR) return 1;

    const d = distanceToSegment(px, py, v.right[0], cy, v.right[1], cy);
    if (v.outlined) {
      if (Math.abs(d - v.barR) <= v.outlineT / 2) return 1;
    } else if (d <= v.barR) {
      return DIM;
    }
  }
  return 0;
}

// 4x4 supersampling. Cheap at these sizes and it's what stops 16px looking
// like it was cut out with scissors.
const SUB = 4;

function renderPixels(size) {
  const scale = UNITS / size;
  const v = size <= SMALL_MAX_SIZE ? SMALL : FULL;
  const data = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let covered = 0;
      let ink = 0;

      for (let sy = 0; sy < SUB; sy++) {
        for (let sx = 0; sx < SUB; sx++) {
          const px = (x + (sx + 0.5) / SUB) * scale;
          const py = (y + (sy + 0.5) / SUB) * scale;
          if (!insideRoundedSquare(px, py)) continue;
          covered += 1;
          ink += inkAt(px, py, v);
        }
      }

      if (covered === 0) continue;

      const alpha = covered / (SUB * SUB);
      const mix = ink / covered;
      const offset = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        data[offset + channel] = Math.round(BG[channel] * (1 - mix) + INK[channel] * mix);
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
  const shape = size <= SMALL_MAX_SIZE ? "small mark" : "full mark";
  console.log(`icon-${size}.png  ${statSync(out).size} bytes  (${shape} destination bars)`);
}

// The store wants a 1024 master for the listing tile; same geometry, no
// small-size compromises.
const master = join(root, "store/icon-1024.png");
mkdirSync(dirname(master), { recursive: true });
writeFileSync(master, encodePng(1024, renderPixels(1024)));
console.log(`icon-1024.png ${statSync(master).size} bytes  (store master)`);

console.log(`\nwrote ${SIZES.length} icons to src/icons/ + a 1024 master to store/`);
