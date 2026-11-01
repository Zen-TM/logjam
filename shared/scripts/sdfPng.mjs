// A polygon as an SDF PNG, for the generators here. MapLibre reads the distance
// from the alpha channel, with the shape's edge at EDGE_ALPHA and a spread of
// SPREAD_PX (why an SDF, and why this encoding: generate-route-arrow-sdf.mjs).
import { deflateSync } from "node:zlib";

export const SPREAD_PX = 8;
export const EDGE_ALPHA = 0.75;

function distanceToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared),
        );
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function isInside(px, py, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

// Minimal PNG writer — zlib is in node, and a dependency for four chunks would
// be a dependency for four chunks.
function crc32(buf) {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
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

/** The polygon's SDF as PNG bytes. Padding round it must exceed SPREAD_PX or
 *  the field gets clipped and the edge stops being smooth. */
export function sdfPng(width, height, points) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Sample at the pixel centre, or the shape lands half a pixel off.
      const px = x + 0.5;
      const py = y + 0.5;
      let distance = Infinity;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        distance = Math.min(
          distance,
          distanceToSegment(px, py, points[i], points[j]),
        );
      }
      const signed = isInside(px, py, points) ? -distance : distance;
      const alpha = Math.round(
        255 * (1 - (signed / SPREAD_PX + (1 - EDGE_ALPHA))),
      );
      const at = (y * width + x) * 4;
      rgba[at] = 255;
      rgba[at + 1] = 255;
      rgba[at + 2] = 255;
      rgba[at + 3] = Math.max(0, Math.min(255, alpha));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
