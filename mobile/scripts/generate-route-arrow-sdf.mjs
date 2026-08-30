// Regenerates src/map/routeArrowSdf.ts — the direction arrowhead drawn along
// routes and tracks. Run with `node scripts/generate-route-arrow-sdf.mjs`.
//
// WHY AN IMAGE AND NOT A GLYPH. The arrows were a text symbol until 2026-08-30,
// which limited them to what the bundled Noto Sans pack ships, and it ships no
// arrowhead: the geometric block has exactly one glyph (U+25CC) and the arrows
// block only U+2190-2199, every one of them stemmed. A stem drawn along a line
// is a second line — at any size that reads as a bulge in the route rather than
// a mark on it, and sizing the arrow up thickens the stem past the 3dp line it
// rides on. See mobile/CLAUDE.md for the centring rule that applies to both.
//
// WHY SDF. A plain PNG icon would be one fixed colour for every route. An SDF
// is a mask the GPU thresholds, so `iconColor` still takes the per-feature
// expression the text layer used, and `iconHaloColor` keeps the dark outline
// that makes the arrow legible over imagery. One native layer, all colours.
//
// WHY A DATA URI AND NOT AN ASSET FILE. A `require()`d image resolves through
// expo-asset, and in a locally-built debuggable release that path is broken:
// expo-asset hands standalone builds off to expo-updates' local-asset store,
// which is EMPTY in such a build, so every asset comes back with `uri: ''` and
// MLRN draws no icon and logs nothing (see mobile/CLAUDE.local.md). The arrow
// is 389 bytes; inlining it as base64 sidesteps the asset registry, the
// packaging step and that bug in one go, and costs less than the `require`
// would. Anything big enough for this to be the wrong trade belongs in assets/.
//
// THE ENCODING IS NOT ARBITRARY. MapLibre reads the distance out of the ALPHA
// channel and takes the shape edge at alpha 191 (0.75) with a spread of 8px —
// the same convention fontnik uses for glyphs, which is what let the glyph
// centring be measured in the first place. RGB is ignored for an SDF, so it is
// left white.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WIDTH = 64;
const HEIGHT = 48;
/** Triangle size in image px. Padding around it must exceed SPREAD_PX or the
 *  field gets clipped and the edge stops being smooth. */
const ARROW_WIDTH = 26;
const ARROW_HEIGHT = 26;
const SPREAD_PX = 8;
const EDGE_ALPHA = 0.75;

/** The arrowhead: a triangle pointing +x, centred on the image centre — which
 *  is what makes it sit ON the line rather than beside it. */
const cx = WIDTH / 2;
const cy = HEIGHT / 2;
const points = [
  [cx + ARROW_WIDTH / 2, cy],
  [cx - ARROW_WIDTH / 2, cy - ARROW_HEIGHT / 2],
  [cx - ARROW_WIDTH / 2, cy + ARROW_HEIGHT / 2],
];

function distanceToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function isInside(px, py) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    // Sample at the pixel centre, or the shape lands half a pixel off.
    const px = x + 0.5;
    const py = y + 0.5;
    let distance = Infinity;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      distance = Math.min(distance, distanceToSegment(px, py, points[i], points[j]));
    }
    const signed = isInside(px, py) ? -distance : distance;
    const alpha = Math.round(255 * (1 - (signed / SPREAD_PX + (1 - EDGE_ALPHA))));
    const at = (y * WIDTH + x) * 4;
    rgba[at] = 255;
    rgba[at + 1] = 255;
    rgba[at + 2] = 255;
    rgba[at + 3] = Math.max(0, Math.min(255, alpha));
  }
}

// Minimal PNG writer — zlib is in node, and a dependency for four chunks would
// be a dependency for four chunks.
function crc32(buf) {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type: RGBA
const raw = Buffer.alloc(HEIGHT * (WIDTH * 4 + 1));
for (let y = 0; y < HEIGHT; y++) {
  raw[y * (WIDTH * 4 + 1)] = 0; // filter: none
  rgba.copy(raw, y * (WIDTH * 4 + 1) + 1, y * WIDTH * 4, (y + 1) * WIDTH * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = join(dirname(fileURLToPath(import.meta.url)), "../src/map/routeArrowSdf.ts");
writeFileSync(
  out,
  `// GENERATED by scripts/generate-route-arrow-sdf.mjs — do not edit by hand.
// Run that script to change the arrowhead's shape; \`routeArrowStyle.ts\` scales
// it, so size is not a reason to regenerate. Guarded by routeArrowStyle.test.ts.
//
// ${WIDTH}x${HEIGHT} SDF, ${ARROW_WIDTH}x${ARROW_HEIGHT} arrowhead centred in it, distance in the alpha
// channel with the shape edge at alpha ${Math.round(EDGE_ALPHA * 255)} and a ${SPREAD_PX}px spread.
export const ROUTE_ARROW_SDF_URI =
  "data:image/png;base64,${png.toString("base64")}";
`,
  "utf8",
);
console.log(`wrote ${out} (${png.length} bytes of PNG, ${WIDTH}x${HEIGHT}, arrow ${ARROW_WIDTH}x${ARROW_HEIGHT})`);
