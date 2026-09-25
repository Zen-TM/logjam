// Terrarium PNG → heights, in JS.
//
// React Native has no canvas, and there is no pixel-access image API in the
// Expo modules this app already carries, so the offline elevation reader
// decodes the tile itself. That is less alarming than it sounds: a terrarium
// tile from the AWS Open Data set is always 8-bit truecolour, non-interlaced,
// 256×256 — so the decoder is a zlib inflate plus the five PNG row filters,
// using `fflate`, which is already a dependency (the GeoPDF path uses it).
//
// Anything outside that shape THROWS rather than guessing: a misread height
// field is a confidently wrong elevation profile, which is worse than none.
import { unzlibSync } from "fflate";
import { DEM_TILE_SIZE, demMetresFromRgb } from "@logjam/shared";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Bytes per pixel of 8-bit truecolour — the filter's `bpp` offset. */
const BYTES_PER_PIXEL = 3;

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

/**
 * Undo the per-row filters in place (PNG spec §9.2). Each row is prefixed by
 * its filter type byte; `raw` holds those prefixed rows back to back.
 */
function unfilter(raw: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * BYTES_PER_PIXEL;
  const out = new Uint8Array(stride * height);
  let source = 0;
  for (let row = 0; row < height; row++) {
    const filter = raw[source++]!;
    const line = row * stride;
    const previous = line - stride;
    for (let i = 0; i < stride; i++) {
      const value = raw[source + i]!;
      const left = i >= BYTES_PER_PIXEL ? out[line + i - BYTES_PER_PIXEL]! : 0;
      const up = row > 0 ? out[previous + i]! : 0;
      const upLeft =
        row > 0 && i >= BYTES_PER_PIXEL ? out[previous + i - BYTES_PER_PIXEL]! : 0;
      let restored: number;
      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + left;
          break;
        case 2:
          restored = value + up;
          break;
        case 3:
          restored = value + ((left + up) >> 1);
          break;
        case 4: {
          // Paeth: pick the neighbour the gradient predicts.
          const p = left + up - upLeft;
          const dLeft = Math.abs(p - left);
          const dUp = Math.abs(p - up);
          const dUpLeft = Math.abs(p - upLeft);
          restored =
            value +
            (dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft);
          break;
        }
        default:
          throw new Error(`Unsupported PNG row filter ${filter}`);
      }
      out[line + i] = restored & 0xff;
    }
    source += stride;
  }
  return out;
}

/**
 * Decode one DEM tile into row-major metres above sea level.
 *
 * Returns a `DEM_TILE_SIZE²` array, matching the index `resolveDemSamples`
 * computes. No-data pixels come out at the terrarium floor and are filtered by
 * `demSampleValue` at read time, not here — this function does one job.
 */
export function decodeDemPng(bytes: Uint8Array): Float32Array {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error("DEM tile is not a PNG");
  }

  let width = 0;
  let height = 0;
  const idatParts: Uint8Array[] = [];
  let offset = PNG_SIGNATURE.length;
  while (offset + 8 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    const body = offset + 8;
    if (type === "IHDR") {
      width = readUint32(bytes, body);
      height = readUint32(bytes, body + 4);
      const bitDepth = bytes[body + 8]!;
      const colorType = bytes[body + 9]!;
      const interlace = bytes[body + 12]!;
      if (bitDepth !== 8 || colorType !== 2 || interlace !== 0) {
        throw new Error(
          `Unsupported DEM tile encoding (depth ${bitDepth}, colour ${colorType}, interlace ${interlace})`,
        );
      }
      if (width !== DEM_TILE_SIZE || height !== DEM_TILE_SIZE) {
        throw new Error(`Unexpected DEM tile size ${width}x${height}`);
      }
    } else if (type === "IDAT") {
      idatParts.push(bytes.subarray(body, body + length));
    } else if (type === "IEND") {
      break;
    }
    // 4 length + 4 type + body + 4 CRC. The CRC is not checked: the tile came
    // out of our own MBTiles, and a corrupt inflate throws below anyway.
    offset = body + length + 4;
  }
  if (width === 0 || idatParts.length === 0) {
    throw new Error("DEM tile has no image data");
  }

  let compressed: Uint8Array;
  if (idatParts.length === 1) {
    compressed = idatParts[0]!;
  } else {
    const total = idatParts.reduce((sum, part) => sum + part.length, 0);
    compressed = new Uint8Array(total);
    let at = 0;
    for (const part of idatParts) {
      compressed.set(part, at);
      at += part.length;
    }
  }

  // `unzlibSync`, not `inflateSync`: PNG's IDAT stream carries the zlib
  // header/checksum around the deflate data, and the raw inflater walks off the
  // end of it ("unexpected EOF").
  const raw = unzlibSync(compressed);
  const expected = (width * BYTES_PER_PIXEL + 1) * height;
  if (raw.length !== expected) {
    throw new Error(`DEM tile inflated to ${raw.length} bytes, expected ${expected}`);
  }

  const pixels = unfilter(raw, width, height);
  const elevations = new Float32Array(width * height);
  for (let i = 0; i < elevations.length; i++) {
    const at = i * BYTES_PER_PIXEL;
    elevations[i] = demMetresFromRgb(pixels[at]!, pixels[at + 1]!, pixels[at + 2]!);
  }
  return elevations;
}
