// The statewide Terrain group's slope and hillshade on a GeoPDF, as pixels.
//
// Logjam Web draws both on the GPU: slope through a `color-relief` paint
// expression, hillshade through MapLibre's own shader. There is no MapLibre
// here, so the slope takes `slopeBandAt` (the rule that expression is built
// from) and the shade is MapLibre's "standard" hillshade (maplibre-gl 6.14's
// `hillshade_prepare` and `hillshade` shaders), ported, so a print looks like
// the screen. Pure, like geoPdfTileMath: render.ts reads the tiles and draws
// the result.
//
// A port of api/src/services/geoPdfTerrain.ts (which the server-removal PR
// deletes) with faster loops: typed lookups instead of per-pixel Maps and
// closures. Same results to the byte; terrain.test.ts holds the originals and
// compares on made-up grids.
//
// Inside a sharpened area the requesting user may read, each tile comes from
// the one archive Logjam Web would draw it from (`terrainTileArchive`, ADR
// 0040), read as deep as the print and the area allow (`terrainReadZoom`).
//
// PRIVACY: an area's id and tile range say where its owner surveyed. Nothing
// in this file logs.
import {
  DEM_NO_DATA_BELOW,
  drawsNswContours,
  drawsNswHillshade,
  lat2tileY,
  lon2tileX,
  metersPerPixel,
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
  // `demMetresFromRgb`, written out: every step is exact in a double, so only
  // the Float32 store rounds, as it does there. A call a pixel is a large
  // part of the decode in a browser that does not optimise (see
  // hillshadePixels). Guard: terrain.test.ts, "decodes a terrarium pixel
  // with the shared rule".
  for (let i = 0, o = 0; i < values.length; i++, o += 4) {
    // A pixel no tile was drawn onto is (0,0,0,0), which decodes to −32768.
    values[i] = rgba[o]! * 256 + rgba[o + 1]! + rgba[o + 2]! / 256 - 32768;
  }
  return { values, width, height };
}

/** Whole degrees the colour table covers; the archive holds 0°–90°. */
const SLOPE_LUT_SIZE = 91;

/** The grid pixels a caller will read, `[x0, x1)` × `[y0, y1)`. */
export type PaintRect = { x0: number; x1: number; y0: number; y1: number };

const wholeGrid = (grid: DemGrid): PaintRect => ({
  x0: 0,
  x1: grid.width,
  y0: 0,
  y1: grid.height,
});

/** Each pixel in its band's colour; clear where `slopeBandAt` is. `out`
 *  starts clear: only coloured pixels are written, and only inside `rect`. */
export function slopePixels(
  grid: DemGrid,
  bands: readonly SlopeBand[],
  out: Uint8ClampedArray = new Uint8ClampedArray(grid.width * grid.height * 4),
  rect: PaintRect = wholeGrid(grid),
): Uint8ClampedArray {
  // ADR 0039: the archive holds whole degrees, so a value is looked up in a
  // table by degree. Anything else (a fraction, no-data, past 90°) falls back
  // to `slopeBandAt`, so a grid that is not whole degrees still paints right.
  // Each degree's RGBA as one 32-bit word, copied whole; a degree no band
  // paints is 0, which leaves the pixel clear as it was.
  const table = new Uint8ClampedArray(SLOPE_LUT_SIZE * 4);
  for (let d = 0; d < SLOPE_LUT_SIZE; d++) {
    const band = slopeBandAt(bands, d);
    if (band) table.set(parseRgbaHex(band.colour), d * 4);
  }
  const table32 = new Uint32Array(table.buffer);
  const out32 = new Uint32Array(out.buffer, out.byteOffset, out.length >> 2);
  const { values, width } = grid;
  const fallback = new Map<number, number[] | null>();
  for (let y = rect.y0; y < rect.y1; y++) {
    const rowEnd = y * width + rect.x1;
    for (let i = y * width + rect.x0; i < rowEnd; i++) {
      const degrees = values[i]!;
      const whole = degrees | 0;
      if (whole === degrees && whole >= 0 && whole < SLOPE_LUT_SIZE) {
        const rgba = table32[whole]!;
        if (rgba !== 0) out32[i] = rgba;
        continue;
      }
      let colour = fallback.get(degrees);
      if (colour === undefined) {
        const band = slopeBandAt(bands, degrees);
        colour = band ? parseRgbaHex(band.colour) : null;
        fallback.set(degrees, colour);
      }
      if (colour) out.set(colour, i * 4);
    }
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

/**
 * The hillshade of a height grid read at `zoom`, whose top row is the top of
 * tile row `tileY`, as Logjam Web shades tiles of that zoom. Straight-alpha
 * RGBA into `out`, which starts clear: a pixel is left alone where a height
 * or one of its eight neighbours is missing. The
 * grid's own edge is read as if the edge pixel repeated: it is a tile edge
 * outside the printed area. Only pixels inside `rect` are painted; their
 * neighbours are read from the whole grid all the same.
 */
export function hillshadePixels(
  grid: DemGrid,
  zoom: number,
  tileY: number,
  out: Uint8ClampedArray = new Uint8ClampedArray(grid.width * grid.height * 4),
  /** Rows of the whole grid above this one, when it is a band of a larger one. */
  rowOffset = 0,
  rect: PaintRect = wholeGrid(grid),
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
  // The prepared texture holds deriv / 8 + 128/255 in a byte, so it saturates.
  const lo = -128 / 255;
  const hi = 127 / 255;
  const T = DEM_NO_DATA_BELOW;

  // The loop is written for a browser that runs it unoptimised (Android's
  // Advanced Protection turns Chrome's JavaScript optimiser off, and the
  // render is then several times slower): no call it can avoid, each height
  // read once. The arithmetic is the original's, step for step, so the bytes
  // are too (terrain.test.ts, "the faster terrain loops").
  for (let y = rect.y0; y < rect.y1; y++) {
    const lat = tileY2lat(tileY + (y + rowOffset + 0.5) / TILE_SIZE, zoom);
    const cosLat = Math.cos(lat * DEG_TO_RAD);
    // The grid's own edge reads as if its edge pixel repeated.
    const rowM = (y > 0 ? y - 1 : 0) * width;
    const row0 = y * width;
    const rowP = (y < height - 1 ? y + 1 : y) * width;
    // A 3 × 3 window that slides right: columns a d g, b e h, c f i. A
    // column is usable when none of its three heights is missing.
    const xm = rect.x0 > 0 ? rect.x0 - 1 : 0;
    let a = values[rowM + xm]!;
    let d = values[row0 + xm]!;
    let g = values[rowP + xm]!;
    let b = values[rowM + rect.x0]!;
    let e = values[row0 + rect.x0]!;
    let h = values[rowP + rect.x0]!;
    let okL = !(a <= T || d <= T || g <= T);
    let okC = !(b <= T || e <= T || h <= T);
    for (let x = rect.x0; x < rect.x1; x++) {
      const xp = x < width - 1 ? x + 1 : x;
      const c = values[rowM + xp]!;
      const f = values[row0 + xp]!;
      const i = values[rowP + xp]!;
      const okR = !(c <= T || f <= T || i <= T);
      if (okL && okC && okR) {
        // `stored`: v / 8, clamped to the byte's range, times 8.
        let sx = (c + f + f + i - (a + d + d + g)) / divisor / 8;
        sx = sx < hi ? sx : hi;
        sx = sx > lo ? sx : lo;
        let sy = (g + h + h + i - (a + b + b + c)) / divisor / 8;
        sy = sy < hi ? sy : hi;
        sy = sy > lo ? sy : lo;
        const dx = (sx * 8) / cosLat;
        const dy = (sy * 8) / cosLat;
        // The shader takes sin and cos of atan(0.625 × |gradient|). With
        // t = 0.625 × |gradient| those are t / √(1+t²) and 1 / √(1+t²): one
        // square root where an atan, a sin and a cos were. The same numbers,
        // to within the last bit of a double (the bytes test in terrain.test.ts).
        const t = 0.625 * Math.sqrt(dx * dx + dy * dy);
        const cosSlope = 1 / Math.sqrt(1 + t * t);
        const shadeAlpha = t * cosSlope;
        const alpha = (1 - cosSlope) * (1 - shadeAlpha) + shadeAlpha;
        if (!(alpha <= 0)) {
          const aspect =
            dx !== 0 ? Math.atan2(dy, -dx) : (Math.PI / 2) * (dy > 0 ? 1 : -1);
          // GLSL's mod(m, 2) - 1. m is in [2.36, 4.37] (aspect is within
          // ±π), so `| 0` is its floor.
          const m = (aspect + azimuth) / Math.PI + 0.5;
          const r = m - 2 * ((m / 2) | 0) - 1;
          // At exaggeration 0.5 the shader's scaled slope is the slope itself.
          const shade = r < 0 ? -r : r;
          const o = (row0 + x) * 4;
          out[o] = out[o + 1] = out[o + 2] = (255 * shade * shadeAlpha) / alpha;
          out[o + 3] = 255 * alpha;
        }
      }
      a = b;
      b = c;
      d = e;
      e = f;
      g = h;
      h = i;
      okL = okC;
      okC = okR;
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
 * The contour tiles a print reads, grouped by the archive each comes from
 * (`STATEWIDE` or an area's id): at z14 and deeper the first area with a
 * contour archive whose range holds the tile, else statewide
 * (`terrainTileArchive`). Never absent: deeper zooms overzoom z14.
 */
export function contourTilesBySource(
  areas: readonly SharpenedArea[],
  tiles: readonly TileCoord[],
): Map<string, TileCoord[]> {
  const bySource = new Map<string, TileCoord[]>();
  for (const tile of tiles) {
    const answer = terrainTileArchive(
      areas,
      "contours",
      tile.z,
      tile.x,
      tile.y,
    );
    if (answer === "absent") continue;
    const source = answer === "statewide" ? STATEWIDE : answer.id;
    const group = bySource.get(source) ?? [];
    group.push(tile);
    bySource.set(source, group);
  }
  return bySource;
}

/**
 * The credit lines for the terrain a print drew: the statewide line for every
 * layer drawn, then each area's survey for the layers that area supplied,
 * worded the same way. The statewide line is the NSW 5 m credit an area's
 * always carries too (`demCredits`), because its edge tiles hold 5 m heights,
 * so it names every layer an area supplied as well as `drawn`. Guard: the
 * "beside the NSW 5 m data" test in geoPdfTerrain.unit.test.ts.
 */
export function terrainCreditLines(
  drawn: ReadonlySet<TerrainLayerKey>,
  areas: ReadonlyMap<SharpenedArea, ReadonlySet<TerrainLayerKey>>,
): string[] {
  const lines = [
    terrainCredit(
      new Set([...drawn, ...[...areas.values()].flatMap((l) => [...l])]),
    ),
    ...[...areas].map(([area, layers]) => terrainCredit(layers, area.credit)),
  ].filter((line): line is string => line !== null);
  return [...new Set(lines)];
}

/**
 * Which of the statewide shade and contours a print draws: the ones in its
 * overlays, minus those its base sheet already carries (imagery its own
 * shadows, a topographic sheet its own contours). A saved request, an older
 * client or a direct call can ask for either over any sheet, so the renderer
 * decides, not the dialog. Guard: `geoPdfTerrain.unit.test.ts` ("overlaysDrawn").
 */
export function overlaysDrawn(config: {
  baseLayer: string;
  overlays: readonly string[];
}): { hillshade: boolean; contours: boolean } {
  return {
    hillshade: drawsNswHillshade(
      config.baseLayer,
      config.overlays.includes("hillshade"),
    ),
    contours: drawsNswContours(
      config.baseLayer,
      config.overlays.includes("contours"),
    ),
  };
}

/**
 * Where the map's pixels sit on a terrain grid: `computeTileToMapTransform`'s
 * numbers, which the server hands the canvas as
 * `setTransform(scaleX, 0, 0, scaleY, -offsetX * scaleX, -offsetY * scaleY)`.
 * Grid pixel = map pixel / scale + offset, measured from the top left of the
 * grid's first tile.
 */
export type GridPlacement = {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
};

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

/**
 * The map rows `outY` to `outY + outH` of RGBA grid pixels, on the map's pixels,
 * as a canvas stretching the grid by `place` would draw them, but computed
 * here so a pixel is a pure function of its map coordinates: a strip of the
 * map and the whole map give the same bytes. `src` holds the grid rows from
 * `srcRow0` (a row of the whole grid) down; every neighbour a pixel reads must
 * be in it, which the caller's halo of a tile row guarantees, or it is clamped
 * as the grid's own edge is.
 *
 * `smooth` reads bilinearly, in premultiplied alpha as a canvas does, and
 * needs grey pixels (R = G = B, the hillshade); otherwise nearest, so a
 * slope band keeps its hard edge.
 */
export function resampleGrid(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  srcRow0: number,
  place: GridPlacement,
  smooth: boolean,
  outW: number,
  outY: number,
  outH: number,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(outW * outH * 4);
  const { scaleX, scaleY, offsetX, offsetY } = place;
  const maxX = srcW - 1;
  const maxY = srcH - 1;
  if (!smooth) {
    const col = new Int32Array(outW);
    for (let px = 0; px < outW; px++)
      col[px] = clamp(Math.floor((px + 0.5) / scaleX + offsetX), 0, maxX);
    const s32 = new Uint32Array(src.buffer, src.byteOffset, srcW * srcH);
    const o32 = new Uint32Array(out.buffer);
    for (let r = 0; r < outH; r++) {
      const gy = Math.floor((outY + r + 0.5) / scaleY + offsetY) - srcRow0;
      const row = clamp(gy, 0, maxY) * srcW;
      const o = r * outW;
      for (let px = 0; px < outW; px++) o32[o + px] = s32[row + col[px]!]!;
    }
    return out;
  }
  // Per column: where the two reads are (RGBA offsets) and their weights.
  const xa = new Int32Array(outW);
  const xb = new Int32Array(outW);
  const fxs = new Float64Array(outW);
  const gxs = new Float64Array(outW);
  for (let px = 0; px < outW; px++) {
    const u = (px + 0.5) / scaleX + offsetX - 0.5;
    const x0 = Math.floor(u);
    const fx = u - x0;
    fxs[px] = fx;
    gxs[px] = 1 - fx;
    xa[px] = clamp(x0, 0, maxX) * 4;
    xb[px] = clamp(x0 + 1, 0, maxX) * 4;
  }
  // Separable: each grid row is blended across once, into premultiplied
  // alpha and grey, and an output row blends the two rows it falls between.
  // A grid row serves about two output rows on each side, so this is about
  // half the work of blending four pixels per output pixel, which matters
  // most where the browser does not optimise (see hillshadePixels). The sums
  // are the four-pixel blend's, grouped differently: a byte can differ only
  // where a value falls within about 1e-13 of a rounding tie, by one level
  // (none in 26 M bytes of a made-up hillshade). Guard: terrain.test.ts,
  // "blends as the four-pixel bilinear".
  let alphaA = new Float64Array(outW);
  let greyA = new Float64Array(outW);
  let alphaB = new Float64Array(outW);
  let greyB = new Float64Array(outW);
  let rowOfA = -1;
  let rowOfB = -1;
  const across = (row: number, alpha: Float64Array, grey: Float64Array) => {
    const base = row * srcW * 4;
    for (let px = 0; px < outW; px++) {
      const i = base + xa[px]!;
      const j = base + xb[px]!;
      const wa = gxs[px]! * src[i + 3]!;
      const wb = fxs[px]! * src[j + 3]!;
      alpha[px] = wa + wb;
      grey[px] = wa * src[i]! + wb * src[j]!;
    }
  };
  let o = 0;
  for (let r = 0; r < outH; r++) {
    const v = (outY + r + 0.5) / scaleY + offsetY - 0.5;
    const y0 = Math.floor(v);
    const fy = v - y0;
    const gy = 1 - fy;
    const rowA = clamp(y0 - srcRow0, 0, maxY);
    const rowB = clamp(y0 + 1 - srcRow0, 0, maxY);
    if (rowA === rowOfB) {
      // Moved down a grid row: the lower row becomes the upper.
      [alphaA, alphaB] = [alphaB, alphaA];
      [greyA, greyB] = [greyB, greyA];
      rowOfA = rowA;
      rowOfB = -1;
    }
    if (rowA !== rowOfA) {
      across(rowA, alphaA, greyA);
      rowOfA = rowA;
    }
    if (rowB !== rowOfB) {
      across(rowB, alphaB, greyB);
      rowOfB = rowB;
    }
    for (let px = 0; px < outW; px++, o += 4) {
      const alpha = gy * alphaA[px]! + fy * alphaB[px]!;
      if (alpha <= 0) continue;
      out[o] =
        out[o + 1] =
        out[o + 2] =
          (gy * greyA[px]! + fy * greyB[px]!) / alpha;
      out[o + 3] = alpha;
    }
  }
  return out;
}

/**
 * The grid pixels `resampleGrid` reads for the same arguments: a caller paints
 * only these. Worked out with its expressions at the first and last output
 * column and row, which bound the rest. Guard: terrainJobs.test.ts, whose
 * bands leave grid columns unread on both sides.
 */
export function resampleReach(
  srcW: number,
  srcH: number,
  srcRow0: number,
  place: GridPlacement,
  smooth: boolean,
  outW: number,
  outY: number,
  outH: number,
): PaintRect {
  const { scaleX, scaleY, offsetX, offsetY } = place;
  const maxX = srcW - 1;
  const maxY = srcH - 1;
  const lift = smooth ? 0.5 : 0;
  const reach = smooth ? 1 : 0;
  const col = (px: number) => Math.floor((px + 0.5) / scaleX + offsetX - lift);
  const row = (r: number) =>
    Math.floor((outY + r + 0.5) / scaleY + offsetY - lift) - srcRow0;
  return {
    x0: clamp(col(0), 0, maxX),
    x1: clamp(col(outW - 1) + reach, 0, maxX) + 1,
    y0: clamp(row(0), 0, maxY),
    y1: clamp(row(outH - 1) + reach, 0, maxY) + 1,
  };
}

/** Tile rows of DEM a bilinear read and the hillshade's neighbours reach. */
const DEM_READ_MARGIN_PX = 2;
/**
 * The halo, in tile rows, beyond the DEM rows a strip reads. Every pixel a
 * strip reads then has the neighbours the whole map's grid gives it, so the
 * block's own edge (which repeats its edge pixel) never reaches the strip.
 * Guard: terrain.test.ts ("demBlockRows"), and with `DEM_READ_MARGIN_PX` the
 * e2e "DEM tile edge" case when both are 0.
 */
export const DEM_HALO_TILE_ROWS = 1;

/**
 * The tile rows `[r0, r1]` of a `rows`-tall DEM grid that a strip drawing map
 * rows `from` to `to` builds its hillshade or slope from: the rows it reads
 * and a tile row of halo each side, clamped to the grid.
 */
export function demBlockRows(
  from: number,
  to: number,
  place: GridPlacement,
  rows: number,
): { r0: number; r1: number } {
  const top =
    Math.floor((from + 0.5) / place.scaleY + place.offsetY - 0.5) -
    DEM_READ_MARGIN_PX;
  const bottom =
    Math.floor((to - 0.5) / place.scaleY + place.offsetY - 0.5) +
    DEM_READ_MARGIN_PX;
  return {
    r0: Math.max(0, Math.floor(top / TILE_SIZE) - DEM_HALO_TILE_ROWS),
    r1: Math.min(rows - 1, Math.floor(bottom / TILE_SIZE) + DEM_HALO_TILE_ROWS),
  };
}
