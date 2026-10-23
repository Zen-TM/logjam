// The statewide Terrain group's slope and hillshade on a GeoPDF, as pixels.
//
// Logjam Web draws both on the GPU: slope through a `color-relief` paint
// expression, hillshade through MapLibre's own shader. There is no MapLibre
// here, so the slope takes `slopeBandAt` (the rule that expression is built
// from) and the shade is MapLibre's "standard" hillshade (maplibre-gl 6.14's
// `hillshade_prepare` and `hillshade` shaders), ported, so a print looks like
// the screen. Pure, like geoPdfTileMath: generateGeoPdf reads the
// tiles and draws the result.
import {
  DEM_NO_DATA_BELOW,
  metersPerPixel,
  demMetresFromRgb,
  parseRgbaHex,
  NSW_CONTOURS,
  slopeBandAt,
  TILE_SIZE,
  tileY2lat,
  type SlopeBand,
} from "@logjam/shared";

/** A terrarium tile set decoded into one row-major grid: metres, or degrees. */
export type DemGrid = { values: Float32Array; width: number; height: number };

/** RGBA bytes (canvas `ImageData` order) → terrarium values. */
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

/** Each pixel in its band's colour; clear where `slopeBandAt` is. `out`
 *  starts clear: only coloured pixels are written. */
export function slopePixels(
  grid: DemGrid,
  bands: readonly SlopeBand[],
  out: Uint8ClampedArray = new Uint8ClampedArray(grid.width * grid.height * 4),
): Uint8ClampedArray {
  // The archive holds whole degrees, so a few dozen distinct values.
  const colours = new Map<number, number[] | null>();
  for (let i = 0; i < grid.values.length; i++) {
    const degrees = grid.values[i]!;
    let colour = colours.get(degrees);
    if (colour === undefined) {
      const band = slopeBandAt(bands, degrees);
      colour = band ? parseRgbaHex(band.colour) : null;
      colours.set(degrees, colour);
    }
    if (colour) out.set(colour, i * 4);
  }
  return out;
}

// MapLibre's hillshade paint defaults: exaggeration 0.5, light from 335°,
// black shadow and accent, white highlight. Logjam Web's hillshade layer sets
// no paint today, so it draws with these. Nothing ties the two: a paint
// property set in Map.tsx, or a maplibre-gl release that changes the defaults
// or the shaders, makes the print differ from the screen with no test going
// red. The print is north up, so the viewport anchor turns the light by nothing.
const ILLUMINATION_RAD = (335 * Math.PI) / 180;
const DEG_TO_RAD = Math.PI / 180;

/** GLSL's `mod`, which is never negative for a positive divisor. */
const glslMod = (x: number, y: number) => x - y * Math.floor(x / y);

/**
 * The hillshade of a height grid read at `zoom`, whose top row is the top of
 * tile row `tileY`, as Logjam Web shades tiles of that zoom. Straight-alpha
 * RGBA into `out`, which starts clear: a pixel is left alone where a height
 * or one of its eight neighbours is missing. The
 * grid's own edge is read as if the edge pixel repeated: it is a tile edge
 * outside the printed area.
 */
export function hillshadePixels(
  grid: DemGrid,
  zoom: number,
  tileY: number,
  out: Uint8ClampedArray = new Uint8ClampedArray(grid.width * grid.height * 4),
): Uint8ClampedArray {
  const { values, width, height } = grid;
  // Below z15 MapLibre steepens the shading, which makes up for the coarser
  // tiles: on the map, z14, z15 and z16 shade the same ground alike.
  const factor = zoom < 2 ? 0.4 : zoom < 4.5 ? 0.35 : 0.3;
  const exaggeration = zoom < 15 ? (zoom - 15) * factor : 0;
  // 2^28.2562 is eight times the earth's circumference: the derivative comes
  // out as the slope's tangent, times cos(latitude), over the exaggeration.
  const divisor = 2 ** (exaggeration + 28.2562 - zoom) / TILE_SIZE;
  const azimuth = ILLUMINATION_RAD + Math.PI;
  const at = (x: number, y: number) =>
    values[
      Math.min(height - 1, Math.max(0, y)) * width +
        Math.min(width - 1, Math.max(0, x))
    ]!;
  // The prepared texture holds deriv / 8 + 128/255 in a byte, so it saturates.
  const stored = (v: number) =>
    Math.max(-128 / 255, Math.min(127 / 255, v / 8)) * 8;

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
      if (Math.min(a, b, c, d, e, f, g, h, i) <= DEM_NO_DATA_BELOW) continue;
      const dx = stored((c + f + f + i - (a + d + d + g)) / divisor) / cosLat;
      const dy = stored((g + h + h + i - (a + b + b + c)) / divisor) / cosLat;
      const slope = Math.atan(0.625 * Math.hypot(dx, dy));
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

/**
 * The zoom a print at 1:`scale` reads the statewide contours at, or null when
 * Logjam Web would show none at that scale: it loads the archive as a vector
 * source, which asks for nothing below the minzoom in the archive's header.
 * The map's camera zoom is 512-based (mapZoom.ts), so it is read through
 * `metersPerPixel`, at one CSS pixel (1/96 in) of screen per `scale` of ground.
 */
export function nswContourZoom(
  scale: number,
  latDeg: number,
  overlayZoom: number,
): number | null {
  const cameraZoom = Math.log2(
    metersPerPixel(latDeg, 0) / ((scale * 0.0254) / 96),
  );
  if (cameraZoom < NSW_CONTOURS.minzoom) return null;
  return Math.min(overlayZoom, NSW_CONTOURS.maxzoom);
}
