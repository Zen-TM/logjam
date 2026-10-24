// The statewide Terrain group's slope and hillshade on a GeoPDF, as pixels.
//
// Logjam Web draws both on the GPU: slope through a `color-relief` paint
// expression, hillshade through MapLibre's own shader. There is no MapLibre
// here, so the slope takes `slopeBandAt` (the rule that expression is built
// from) and the shade is MapLibre's "standard" hillshade (maplibre-gl 6.14's
// `hillshade_prepare` and `hillshade` shaders), ported, so a print looks like
// the screen. Pure, like geoPdfTileMath: generateGeoPdf reads the
// tiles and draws the result.
//
// Inside a sharpened area the requesting user may read, each tile comes from
// the one archive Logjam Web would draw it from (`terrainTileArchive`, ADR
// 0040), read as deep as the print and the area allow (`terrainReadZoom`).
//
// PRIVACY: an area's id and tile range say where its owner surveyed. Nothing
// in this file logs.
import {
  DEM_NO_DATA_BELOW,
  lat2tileY,
  lon2tileX,
  metersPerPixel,
  demMetresFromRgb,
  parseRgbaHex,
  NSW_CONTOURS,
  slopeBandAt,
  terrainCredit,
  terrainTileArchive,
  TILE_SIZE,
  tileY2lat,
  type SharpenedArea,
  type SlopeBand,
  type TerrainLayerKey,
  type TileCoord,
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

/** Where a print reads a terrain tile from: the statewide archive, or an area's. */
export const STATEWIDE = "statewide";

/** A tile a print reads: `source` is `STATEWIDE` or an area's id. */
export type TerrainTileRead = {
  source: string;
  z: number;
  x: number;
  y: number;
};

export const terrainReadKey = (r: TerrainTileRead) =>
  `${r.source} ${r.z}/${r.x}/${r.y}`;

/** The areas whose tiles reach into a page, by their z15 range. */
export function areasOnPage<A extends SharpenedArea>(
  areas: readonly A[],
  extent: { north: number; south: number; east: number; west: number },
): A[] {
  const x0 = lon2tileX(extent.west, 15);
  const x1 = lon2tileX(extent.east, 15);
  const y0 = lat2tileY(extent.north, 15);
  const y1 = lat2tileY(extent.south, 15);
  return areas.filter(
    ({ tiles15: [ax0, ay0, ax1, ay1] }) =>
      ax0 <= x1 && ax1 >= x0 && ay0 <= y1 && ay1 >= y0,
  );
}

/**
 * The zoom a print reads heights or slope at: its own, but no deeper than
 * the statewide archive's `statewideMax` (z15) unless an area on the page
 * holds more, then that area's zmax. At 300 dpi and NSW's latitude a print
 * at 1:50 000 wants z15, 1:25 000 z16, 1:15 000 z17, 1:10 000 z18; the base
 * layer's own cap comes first (`computeZoom`).
 */
export function terrainReadZoom(
  printZoom: number,
  statewideMax: number,
  areas: readonly SharpenedArea[],
): number {
  return Math.min(
    printZoom,
    Math.max(statewideMax, ...areas.map((a) => a.zmax)),
  );
}

/**
 * Which tile a print reads for the heights or slope tile `z/x/y`: the one
 * archive `terrainTileArchive` routes it to or, where that says absent, the
 * nearest ancestor it routes, which a map would draw in its place. Below z15
 * every tile is statewide, so the walk up ends. Memoised: a grid asks for each
 * tile many times.
 */
export function terrainTileReader(
  areas: readonly SharpenedArea[],
  layer: "heights" | "slope",
): (z: number, x: number, y: number) => TerrainTileRead {
  const known = new Map<string, TerrainTileRead>();
  return (z, x, y) => {
    const key = `${z}/${x}/${y}`;
    let read = known.get(key);
    if (!read) {
      for (let up = 0; !read; up++) {
        const answer = terrainTileArchive(
          areas,
          layer,
          z - up,
          x >> up,
          y >> up,
        );
        if (answer !== "absent") {
          const source = answer === "statewide" ? STATEWIDE : answer.id;
          read = { source, z: z - up, x: x >> up, y: y >> up };
        }
      }
      known.set(key, read);
    }
    return read;
  };
}

/**
 * The tiles to fetch for a grid of `tiles` at `zoom`, each once: every
 * tile's read and, where heights are stretched up from an ancestor
 * (`smooth`), the ancestor's eight neighbours, which the stretch reads across
 * its edges.
 */
export function terrainTileReads(
  tiles: readonly TileCoord[],
  zoom: number,
  read: (z: number, x: number, y: number) => TerrainTileRead,
  smooth: boolean,
): TerrainTileRead[] {
  const reads = new Map<string, TerrainTileRead>();
  const add = (r: TerrainTileRead) => reads.set(terrainReadKey(r), r);
  for (const tile of tiles) {
    const r = read(zoom, tile.x, tile.y);
    add(r);
    if (!smooth || r.z === zoom) continue;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) add(read(r.z, r.x + dx, r.y + dy));
    }
  }
  return [...reads.values()];
}

/** −32768, the terrarium no-data value (`DEM_NO_DATA_BELOW`). */
const NO_DATA = -32768;

/**
 * Heights or slope over a `cols` × `rows` block of tiles at `zoom` (top left
 * `minTileX`, `minTileY`) as one grid, each tile from its read in `decoded`
 * (`terrainReadKey` → 256 × 256 values). A read at `zoom` is copied; one from
 * an ancestor is stretched: nearest for slope, so a band keeps its edge, and
 * bilinear for heights, reading across the ancestor's edges into the tiles
 * the router gives beside it, so a hillshade shades no seam where an area's
 * deeper tiles meet the stretched statewide ones. Guard: the plane test in
 * geoPdfTerrain.unit.test.ts.
 */
export function terrainGrid(
  zoom: number,
  minTileX: number,
  minTileY: number,
  cols: number,
  rows: number,
  read: (z: number, x: number, y: number) => TerrainTileRead,
  decoded: ReadonlyMap<string, Float32Array>,
  smooth: boolean,
): DemGrid {
  const width = cols * TILE_SIZE;
  const height = rows * TILE_SIZE;
  const values = new Float32Array(width * height).fill(NO_DATA);
  // A pixel at zoom z (global pixel coordinates), from wherever it is read.
  const at = (z: number, px: number, py: number) => {
    const r = read(z, Math.floor(px / TILE_SIZE), Math.floor(py / TILE_SIZE));
    const tile = decoded.get(terrainReadKey(r));
    if (!tile) return NO_DATA;
    const s = z - r.z;
    return tile[((py >> s) & 255) * TILE_SIZE + ((px >> s) & 255)]!;
  };
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const r = read(zoom, minTileX + tx, minTileY + ty);
      const tile = decoded.get(terrainReadKey(r));
      if (!tile) continue;
      const s = zoom - r.z;
      const k = 2 ** s;
      const gx0 = (minTileX + tx) * TILE_SIZE;
      // The ancestor's top-left pixel, at its own zoom.
      const ax = r.x * TILE_SIZE;
      const ay = r.y * TILE_SIZE;
      for (let j = 0; j < TILE_SIZE; j++) {
        const gy = (minTileY + ty) * TILE_SIZE + j;
        const o = (ty * TILE_SIZE + j) * width + tx * TILE_SIZE;
        if (s === 0) {
          values.set(tile.subarray(j * TILE_SIZE, (j + 1) * TILE_SIZE), o);
          continue;
        }
        if (!smooth) {
          const row = ((gy >> s) & 255) * TILE_SIZE;
          for (let i = 0; i < TILE_SIZE; i++) {
            values[o + i] = tile[row + (((gx0 + i) >> s) & 255)]!;
          }
          continue;
        }
        const v = (gy + 0.5) / k - 0.5;
        const y0 = Math.floor(v);
        const fy = v - y0;
        const ly = y0 - ay;
        for (let i = 0; i < TILE_SIZE; i++) {
          const u = (gx0 + i + 0.5) / k - 0.5;
          const x0 = Math.floor(u);
          const fx = u - x0;
          const lx = x0 - ax;
          let a: number, b: number, c: number, d: number;
          if (lx >= 0 && lx < 255 && ly >= 0 && ly < 255) {
            const p = ly * TILE_SIZE + lx;
            a = tile[p]!;
            b = tile[p + 1]!;
            c = tile[p + TILE_SIZE]!;
            d = tile[p + TILE_SIZE + 1]!;
          } else {
            a = at(r.z, x0, y0);
            b = at(r.z, x0 + 1, y0);
            c = at(r.z, x0, y0 + 1);
            d = at(r.z, x0 + 1, y0 + 1);
          }
          if (Math.min(a, b, c, d) <= DEM_NO_DATA_BELOW) continue;
          values[o + i] =
            (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
        }
      }
    }
  }
  return { values, width, height };
}

/**
 * The credit lines for the terrain a print drew: the statewide line, then
 * each area's survey worded the same way. The statewide line is the NSW 5 m
 * credit an area's always carries too (`demCredits`), because its edge tiles
 * hold 5 m heights; a layer drew wherever an area did, so it is never null
 * then.
 */
export function terrainCreditLines(
  drawn: ReadonlySet<TerrainLayerKey>,
  areas: readonly SharpenedArea[],
): string[] {
  const lines = [
    terrainCredit(drawn),
    ...areas.map((area) => terrainCredit(drawn, area.credit)),
  ].filter((line): line is string => line !== null);
  return [...new Set(lines)];
}
