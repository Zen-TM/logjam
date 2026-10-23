// The statewide Terrain group's slope and hillshade on a GeoPDF, as pixels.
//
// Logjam Web draws both on the GPU: slope through a `color-relief` paint
// expression, hillshade through MapLibre's own shader. There is no MapLibre
// here, so the slope takes `slopeBandAt` (the rule that expression is built
// from) and the shade is MapLibre's "standard" hillshade, ported, so a print
// looks like the screen. Pure, like geoPdfTileMath: generateGeoPdf reads the
// tiles and draws the result.
import {
  demMetresFromRgb,
  slopeBandAt,
  TILE_SIZE,
  tileY2lat,
  type SlopeBand,
} from "@logjam/shared";

/** A terrarium tile set decoded into one row-major grid: metres, or degrees. */
export type DemGrid = { values: Float32Array; width: number; height: number };

/** RGBA bytes (canvas `ImageData` order) → terrarium values; no-data ≤ −32000. */
export function decodeTerrarium(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): DemGrid {
  const values = new Float32Array(width * height);
  for (let i = 0; i < values.length; i++) {
    const o = i * 4;
    // A pixel no tile was drawn onto is (0,0,0,0), which decodes to −32768.
    values[i] = demMetresFromRgb(rgba[o]!, rgba[o + 1]!, rgba[o + 2]!);
  }
  return { values, width, height };
}

/** Each pixel in its band's colour; clear where `slopeBandAt` is. */
export function slopePixels(
  grid: DemGrid,
  bands: readonly SlopeBand[],
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(grid.width * grid.height * 4);
  // The archive holds whole degrees, so a few dozen distinct values.
  const colours = new Map<number, number[] | null>();
  for (let i = 0; i < grid.values.length; i++) {
    const degrees = grid.values[i]!;
    let colour = colours.get(degrees);
    if (colour === undefined) {
      const band = slopeBandAt(bands, degrees);
      colour = band
        ? [1, 3, 5, 7].map((at) => parseInt(band.colour.slice(at, at + 2), 16))
        : null;
      colours.set(degrees, colour);
    }
    if (colour) out.set(colour, i * 4);
  }
  return out;
}

// MapLibre's hillshade paint defaults, which Logjam Web leaves as they are:
// exaggeration 0.5, light from 335°, black shadow and accent, white highlight.
// The print is north up, so the viewport anchor turns the light by nothing.
const ILLUMINATION_RAD = (335 * Math.PI) / 180;
const DEG_TO_RAD = Math.PI / 180;

/** GLSL's `mod`, which is never negative for a positive divisor. */
const glslMod = (x: number, y: number) => x - y * Math.floor(x / y);

/**
 * The hillshade of a height grid whose top row is the top of tile row `tileY`
 * at `zoom`, as MapLibre's `hillshade_prepare` and `hillshade` (standard)
 * shaders draw it at that zoom. Straight-alpha RGBA; clear where a height or
 * one of its eight neighbours is missing. The grid's own edge is read as if
 * the edge pixel repeated: the edge is a tile edge outside the printed area.
 */
export function hillshadePixels(
  grid: DemGrid,
  zoom: number,
  tileY: number,
): Uint8ClampedArray {
  const { values, width, height } = grid;
  const out = new Uint8ClampedArray(width * height * 4);
  const factor = zoom < 2 ? 0.4 : zoom < 4.5 ? 0.35 : 0.3;
  const exaggeration = zoom < 15 ? (zoom - 15) * factor : 0;
  const divisor = 2 ** (exaggeration + (19.2562 - zoom));
  const azimuth = ILLUMINATION_RAD + Math.PI;
  const at = (x: number, y: number) =>
    values[
      Math.min(height - 1, Math.max(0, y)) * width +
        Math.min(width - 1, Math.max(0, x))
    ]!;
  // The prepared texture holds each derivative in one byte, so it saturates.
  const clampUnit = (v: number) => Math.max(-1, Math.min(1, v));

  for (let y = 0; y < height; y++) {
    const lat = tileY2lat(tileY + (y + 0.5) / TILE_SIZE, zoom);
    const cosLat = Math.cos(lat * DEG_TO_RAD);
    for (let x = 0; x < width; x++) {
      const a = at(x - 1, y - 1);
      const b = at(x, y - 1);
      const c = at(x + 1, y - 1);
      const d = at(x - 1, y);
      const e = at(x, y);
      const f = at(x + 1, y);
      const g = at(x - 1, y + 1);
      const h = at(x, y + 1);
      const i = at(x + 1, y + 1);
      if (Math.min(a, b, c, d, e, f, g, h, i) <= -32000) continue;
      const dx = clampUnit((c + f + f + i - (a + d + d + g)) / divisor);
      const dy = clampUnit((g + h + h + i - (a + b + b + c)) / divisor);
      const slope = Math.atan((1.25 * Math.hypot(dx, dy)) / cosLat);
      const aspect =
        dx !== 0 ? Math.atan2(dy, -dx) : (Math.PI / 2) * (dy > 0 ? 1 : -1);
      // At exaggeration 0.5 the shader's scaled slope is the slope itself.
      const shade = Math.abs(
        glslMod((aspect + azimuth) / Math.PI + 0.5, 2) - 1,
      );
      const shadeAlpha = Math.sin(slope);
      const alpha = (1 - Math.cos(slope)) * (1 - shadeAlpha) + shadeAlpha;
      if (alpha <= 0) continue;
      const grey = (255 * shade * shadeAlpha) / alpha;
      const o = (y * width + x) * 4;
      out[o] = out[o + 1] = out[o + 2] = grey;
      out[o + 3] = 255 * alpha;
    }
  }
  return out;
}
