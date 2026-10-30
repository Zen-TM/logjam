import { describe, expect, it } from "vitest";
import {
  lat2tileY,
  NSW_5M,
  NSW_HILLSHADE,
  NSW_SLOPE,
  RASTER_TEMPLATE_DEFAULTS,
  type SharpenedArea,
  type TileCoord,
  tileY2lat,
  DEM_NO_DATA_BELOW,
  parseRgbaHex,
  slopeBandAt,
  demMetresFromRgb,
  TILE_SIZE,
  type SlopeBand,
} from "@logjam/shared";
import {
  areasOnPage,
  contourTilesBySource,
  decodeTerrarium,
  hillshadePixels,
  nswContourZoom,
  overlaysDrawn,
  slopePixels,
  STATEWIDE,
  terrainCreditLines,
  terrainGrid,
  terrainReadKey,
  terrainReadZoom,
  terrainTileReader,
  terrainTileReads,
  resampleGrid,
  demBlockRows,
  type DemGrid,
  type TerrainTileRead,
} from "./terrain";

// Made-up grids: a plane tilted a known way, at latitude -33.7.
const SIZE = 8;
const ZOOM = 15;
const TILE_Y = lat2tileY(-33.7, ZOOM);

function plane(rise: (x: number, y: number) => number): DemGrid {
  const values = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) values[y * SIZE + x] = 500 + rise(x, y);
  return { values, width: SIZE, height: SIZE };
}

const centre = (pixels: Uint8ClampedArray) => {
  const o = ((SIZE / 2) * SIZE + SIZE / 2) * 4;
  return { grey: pixels[o]!, alpha: pixels[o + 3]! };
};

describe("hillshadePixels", () => {
  // y counts down the grid, so rising with x and y is ground that faces
  // north-west, toward the light at 335°.
  const facingLight = plane((x, y) => (x + y) * 1.2);
  const facingAway = plane((x, y) => -(x + y) * 1.2);

  // Mutation: take the north row from the south one in either derivative, and
  // the light lands on the far side of the hill.
  it("lights a face that looks toward the light and shades one that looks away", () => {
    const lit = centre(hillshadePixels(facingLight, ZOOM, TILE_Y));
    const shaded = centre(hillshadePixels(facingAway, ZOOM, TILE_Y));
    expect(lit.grey).toBeGreaterThan(200);
    expect(shaded.grey).toBeLessThan(55);
    expect(lit.alpha).toBeGreaterThan(0);
    expect(shaded.alpha).toBeGreaterThan(0);
  });

  it("leaves flat ground clear", () => {
    expect(
      centre(
        hillshadePixels(
          plane(() => 0),
          ZOOM,
          TILE_Y,
        ),
      ).alpha,
    ).toBe(0);
  });

  // The ground size of one z15 pixel on the centre row.
  const centreLat = tileY2lat(TILE_Y + (SIZE / 2 + 0.5) / 256, ZOOM);
  const pixelM =
    (40075016.686 * Math.cos((centreLat * Math.PI) / 180)) / (256 * 2 ** ZOOM);

  // MapLibre shades a slope as if it were atan(0.625 × tan(slope)), however
  // far the map is zoomed in: 45° shades as 32°. Mutation: change the 0.625,
  // drop the cos(latitude), or leave out the tile size from the divisor.
  it("shades a 45° face as MapLibre does", () => {
    const shaded = Math.atan(0.625);
    const alpha =
      (1 - Math.cos(shaded)) * (1 - Math.sin(shaded)) + Math.sin(shaded);
    const face = plane((x) => x * pixelM);
    expect(centre(hillshadePixels(face, ZOOM, TILE_Y)).alpha).toBeCloseTo(
      255 * alpha,
      -0.5,
    );
  });

  // Below z15 MapLibre steepens the shading of the coarser tiles. Mutation:
  // drop the exaggeration.
  it("steepens the shading of heights read below z15, as the map does", () => {
    const at = (zoom: number) => {
      const tileY = lat2tileY(-33.7, zoom);
      const lat = tileY2lat(tileY + (SIZE / 2 + 0.5) / 256, zoom);
      const pixel =
        (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** zoom);
      // The same 27° face at both zooms.
      const face = plane((x) => x * 0.5 * pixel);
      return centre(hillshadePixels(face, zoom, tileY)).alpha;
    };
    expect(at(13)).toBeGreaterThan(at(15) + 10);
  });

  // Mutation: drop the clamp on the derivative. MapLibre stores it in a byte,
  // so past ~78° here every face shades alike, and the print must too.
  it("shades every near-vertical face alike, as the screen does", () => {
    const steep = hillshadePixels(
      plane((x) => x * 6 * pixelM),
      ZOOM,
      TILE_Y,
    );
    const cliff = hillshadePixels(
      plane((x) => x * 12 * pixelM),
      ZOOM,
      TILE_Y,
    );
    expect(centre(cliff)).toEqual(centre(steep));
    expect(
      centre(
        hillshadePixels(
          plane((x) => x * 2 * pixelM),
          ZOOM,
          TILE_Y,
        ),
      ),
    ).not.toEqual(centre(steep));
  });

  it("is clear wherever a neighbour has no height", () => {
    const grid = facingLight;
    grid.values[(SIZE / 2 - 1) * SIZE + SIZE / 2] = -32768;
    expect(centre(hillshadePixels(grid, ZOOM, TILE_Y)).alpha).toBe(0);
  });
});

describe("slopePixels", () => {
  const bands = RASTER_TEMPLATE_DEFAULTS.slope.bands;
  const grid = (degrees: number[]): DemGrid => ({
    values: Float32Array.from(degrees),
    width: degrees.length,
    height: 1,
  });

  it("paints a slope in its band's colour and the rest clear", () => {
    const first = bands[0]!;
    const pixels = slopePixels(grid([first.fromDeg, 0, -32768]), bands);
    expect([...pixels.slice(0, 4)]).toEqual(parseRgbaHex(first.colour));
    // Under the first band, and no data: both clear.
    expect(first.fromDeg).toBeGreaterThan(0);
    expect(pixels[7]).toBe(0);
    expect(pixels[11]).toBe(0);
  });
});

describe("decodeTerrarium", () => {
  it("reads a pixel no tile was drawn onto as no data", () => {
    const { values } = decodeTerrarium(new Uint8ClampedArray(4), 1, 1);
    expect(values[0]).toBeLessThanOrEqual(DEM_NO_DATA_BELOW);
  });
});

describe("nswContourZoom", () => {
  // Logjam Web shows the statewide contours from camera z11, about 1:120 000
  // at lat -33.7. Mutation: gate on the print's 256-based style zoom, one
  // level higher, and a 1:200 000 print draws and credits 50 m lines the map
  // never shows.
  it("reads no contours where the map draws none", () => {
    expect(nswContourZoom(200000, -33.7, 12)).toBeNull();
    expect(nswContourZoom(130000, -33.7, 13)).toBeNull();
    expect(nswContourZoom(110000, -33.7, 13)).toBe(13);
    // The archive stops at z14; deeper prints stretch it.
    expect(nswContourZoom(25000, -33.7, 16)).toBe(14);
  });
});

// Made-up areas: one z14 tile's worth of z15 tiles, x 60000–60001, y
// 39000–39001. The z15 column to their east (60002) is outside every area.
const area = (zmax: 16 | 17, id = `area-${zmax}`): SharpenedArea => ({
  id,
  zmax,
  tiles15: [60000, 39000, 60001, 39001],
  coverage: [0, 0, 0, 0],
  contours: true,
  credit: "Elevation: derived from a made-up survey. CC BY 3.0 AU.",
  createdAt: "2026-10-24T00:00:00.000Z",
});

/** A row of tiles at `z`, across the area's east edge: half in, half out. */
function acrossTheEdge(z: number, rows = 1): TileCoord[] {
  const k = 2 ** (z - 15);
  const tiles: TileCoord[] = [];
  for (let y = 39000 * k; y < 39000 * k + rows; y++)
    for (let x = 60001 * k; x < 60003 * k; x++) tiles.push({ z, x, y });
  return tiles;
}

/** Each read's tile, every value from `value(read, i, j)`. */
function decode(
  reads: TerrainTileRead[],
  value: (r: TerrainTileRead, i: number, j: number) => number,
) {
  const decoded = new Map<string, Float32Array>();
  for (const r of reads) {
    const tile = new Float32Array(256 * 256);
    for (let j = 0; j < 256; j++)
      for (let i = 0; i < 256; i++) tile[j * 256 + i] = value(r, i, j);
    decoded.set(terrainReadKey(r), tile);
  }
  return decoded;
}

describe("terrainGrid", () => {
  // Mutation: read every tile at the grid's zoom, ignoring the router's
  // "absent" (the ancestor walk), or read the statewide tile inside the area.
  it("reads each tile from the archive the router gives it, its parent past the area's zmax", () => {
    const tiles = acrossTheEdge(17);
    const read = terrainTileReader([area(16)], "slope");
    const reads = terrainTileReads(tiles, 17, read, false);
    expect(reads.map((r) => [r.source, r.z]).sort()).toEqual([
      ["area-16", 16],
      ["area-16", 16],
      [STATEWIDE, 15],
    ]);
    const decoded = decode(reads, (r) => (r.source === STATEWIDE ? 10 : 40));
    const grid = terrainGrid(
      17,
      60001 * 4,
      39000 * 4,
      8,
      1,
      read,
      decoded,
      false,
    );
    const row = Array.from(grid.values.subarray(0, grid.width));
    expect(row.slice(0, 4 * 256).every((v) => v === 40)).toBe(true);
    expect(row.slice(4 * 256).every((v) => v === 10)).toBe(true);
  });

  // A plane is the hard case for a seam: every archive holds the same tilted
  // ground, at its own zoom, so the grid must be that plane everywhere,
  // across the area's edge and every stretched tile's edge, and shade alike.
  // Mutation: stretch an ancestor without reading its neighbours (drop them
  // from terrainTileReads, or clamp to its own tile).
  it("stretches heights with no seam at an area's edge", () => {
    const z = 17;
    const tiles = acrossTheEdge(z, 2);
    const read = terrainTileReader([area(17)], "heights");
    const reads = terrainTileReads(tiles, z, read, true);
    const x0 = 60001 * 4 * 256;
    const y0 = 39000 * 4 * 256;
    // Metres at a z17 pixel centre: a steady slope, facing south-east.
    const height = (gx: number, gy: number) =>
      300 + 0.5 * (gx - x0) + 0.25 * (gy - y0);
    const decoded = decode(reads, (r, i, j) => {
      const k = 2 ** (z - r.z);
      return height(
        (r.x * 256 + i + 0.5) * k - 0.5,
        (r.y * 256 + j + 0.5) * k - 0.5,
      );
    });
    const grid = terrainGrid(
      z,
      60001 * 4,
      39000 * 4,
      8,
      2,
      read,
      decoded,
      true,
    );
    let worst = 0;
    for (let j = 0; j < grid.height; j++)
      for (let i = 0; i < grid.width; i++)
        worst = Math.max(
          worst,
          Math.abs(grid.values[j * grid.width + i]! - height(x0 + i, y0 + j)),
        );
    expect(worst).toBeLessThan(0.01);

    const shade = hillshadePixels(grid, z, 39000 * 4);
    const greys = new Set<string>();
    for (let j = 1; j < grid.height - 1; j++)
      for (let i = 1; i < grid.width - 1; i++)
        greys.add(
          `${shade[(j * grid.width + i) * 4]} ${shade[(j * grid.width + i) * 4 + 3]}`,
        );
    expect([...greys]).toHaveLength(1);
    expect(shade[(grid.width + 1) * 4 + 3]).toBeGreaterThan(0);
  });
});

describe("terrainReadZoom", () => {
  // Mutation: read areas at z15 like the statewide archive, or at their
  // zmax past the print's own zoom.
  it("reads as deep as the print wants, the statewide z15 or an area's zmax at most", () => {
    const max = NSW_SLOPE.maxzoom;
    expect(terrainReadZoom(18, max, [])).toBe(15);
    expect(terrainReadZoom(18, max, [area(16)])).toBe(16);
    expect(terrainReadZoom(18, max, [area(16), area(17)])).toBe(17);
    expect(terrainReadZoom(16, max, [area(17)])).toBe(16);
    expect(terrainReadZoom(14, max, [area(17)])).toBe(14);
  });

  // Mutation: keep every area, so one off the page deepens the read.
  it("counts only the areas on the page", () => {
    const tileWest = (x: number) => (x / 2 ** 15) * 360 - 180;
    const lat = (y: number) => tileY2lat(y + 0.5, 15);
    const on = {
      north: lat(39000),
      south: lat(39001),
      west: tileWest(60001.5),
      east: tileWest(60002.5),
    };
    const off = { ...on, west: tileWest(60003.5), east: tileWest(60004.5) };
    expect(areasOnPage([area(17)], on)).toHaveLength(1);
    expect(areasOnPage([area(17)], off)).toHaveLength(0);
  });
});

describe("contourTilesBySource", () => {
  // Mutation: send every tile to the statewide archive, or route areas with
  // no contour archive (`contours: false`) to their own.
  it("reads each contour tile from the first area with contours that holds it, else statewide", () => {
    const tiles = [
      { z: 14, x: 30000, y: 19500 }, // the areas' z14 tile
      { z: 14, x: 30001, y: 19500 }, // east of every area
    ];
    const none = { ...area(17, "no-contours"), contours: false };
    const grouped = contourTilesBySource([none, area(16)], tiles);
    expect([...grouped]).toEqual([
      ["area-16", [tiles[0]]],
      [STATEWIDE, [tiles[1]]],
    ]);
    expect([...contourTilesBySource([none], tiles).keys()]).toEqual([
      STATEWIDE,
    ]);
  });
});

describe("terrainCreditLines", () => {
  const SURVEY = "derived from a made-up survey. CC BY 3.0 AU.";

  // Mutations: word an area's line from every layer the page drew; build the
  // NSW 5 m line from `drawn` alone, leaving an area's layers out of it.
  it("credits each area's survey for the layers it supplied, beside the NSW 5 m data", () => {
    const drawn = new Set(["contours", "slope"] as const);
    expect(terrainCreditLines(drawn, new Map())).toEqual([
      NSW_5M.credit.replace(/^Elevation/, "Contours and slope"),
    ]);
    expect(
      terrainCreditLines(
        drawn,
        new Map([
          [area(16), new Set(["slope"] as const)],
          [area(17, "another"), new Set(["slope"] as const)],
        ]),
      ),
    ).toEqual([
      NSW_5M.credit.replace(/^Elevation/, "Contours and slope"),
      `Slope: ${SURVEY}`,
    ]);
    expect(
      terrainCreditLines(
        new Set(),
        new Map([[area(16), new Set(["hillshade"] as const)]]),
      ),
    ).toEqual([NSW_HILLSHADE.credit, `Hillshade: ${SURVEY}`]);
  });
});

describe("overlaysDrawn", () => {
  // Mutation: drop the `drawsNswHillshade` call (a bare `overlays.includes`),
  // and a request for hillshade over imagery prints a shade over photographs
  // that carry their own.
  it("draws no hillshade over imagery, and no contours over a topographic sheet", () => {
    const overlays = ["hillshade", "contours"];
    expect(overlaysDrawn({ baseLayer: "six-imagery", overlays })).toEqual({
      hillshade: false,
      contours: true,
    });
    expect(overlaysDrawn({ baseLayer: "six-topo", overlays })).toEqual({
      hillshade: true,
      contours: false,
    });
    expect(overlaysDrawn({ baseLayer: "protomaps", overlays: [] })).toEqual({
      hillshade: false,
      contours: false,
    });
  });
});

// ── The faster loops against the originals ──────────────────────────────────
// The server's loops as they were ported (per-pixel Map, per-pixel clamps),
// kept here so "the same bytes" is checked, not claimed. Mutation: change a
// constant or the neighbour order in terrain.ts's hillshadePixels, or the
// table in slopePixels, and a made-up grid below differs.

const glslMod = (x: number, y: number) => x - y * Math.floor(x / y);
function originalHillshade(grid: DemGrid, zoom: number, tileY: number) {
  const out = new Uint8ClampedArray(grid.width * grid.height * 4);
  const { values, width, height } = grid;
  const factor = zoom < 2 ? 0.4 : zoom < 4.5 ? 0.35 : 0.3;
  const exaggeration = zoom < 15 ? (zoom - 15) * factor : 0;
  const divisor = 2 ** (exaggeration + 28.2562 - zoom) / TILE_SIZE;
  const azimuth = (335 * Math.PI) / 180 + Math.PI;
  const at = (x: number, y: number) =>
    values[
      Math.min(height - 1, Math.max(0, y)) * width +
        Math.min(width - 1, Math.max(0, x))
    ]!;
  const stored = (v: number) =>
    Math.max(-128 / 255, Math.min(127 / 255, v / 8)) * 8;
  for (let y = 0; y < height; y++) {
    const lat = tileY2lat(tileY + (y + 0.5) / TILE_SIZE, zoom);
    const cosLat = Math.cos((lat * Math.PI) / 180);
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

function originalSlope(grid: DemGrid, bands: readonly SlopeBand[]) {
  const out = new Uint8ClampedArray(grid.width * grid.height * 4);
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

/** Deterministic noise, so a failure reproduces. */
function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function bumpyGrid(width: number, height: number): DemGrid {
  const rand = lcg(7);
  const values = new Float32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      values[y * width + x] =
        400 + 80 * Math.sin(x / 7) * Math.cos(y / 5) + rand() * 3;
  // A few holes, one on the grid's edge.
  values[3 * width + 4] = -32768;
  values[0] = -32768;
  values[(height - 1) * width + width - 1] = -32768;
  return { values, width, height };
}

describe("the faster terrain loops", () => {
  it("shades a bumpy grid with holes to the byte, at several zooms", () => {
    const grid = bumpyGrid(53, 41);
    for (const zoom of [12, 14, 15, 17]) {
      const tileY = lat2tileY(-33.7, zoom);
      expect(hillshadePixels(grid, zoom, tileY)).toEqual(
        originalHillshade(grid, zoom, tileY),
      );
    }
  });

  // Mutation: drop either clamp of `stored` in hillshadePixels, slide the
  // window one column late, or paint outside `rect`.
  it("shades cliffs steep enough to saturate, inside a rect only, as the original", () => {
    const grid = bumpyGrid(61, 37);
    for (let y = 0; y < grid.height; y++)
      for (let x = 30; x < grid.width; x++)
        grid.values[y * grid.width + x]! += 900 + 40 * (y % 5);
    const rect = { x0: 3, x1: 50, y0: 2, y1: 30 };
    for (const zoom of [13, 15, 17]) {
      const tileY = lat2tileY(-33.7, zoom);
      const want = originalHillshade(grid, zoom, tileY);
      expect(hillshadePixels(grid, zoom, tileY)).toEqual(want);
      const got = hillshadePixels(grid, zoom, tileY, undefined, 0, rect);
      for (let y = 0; y < grid.height; y++)
        for (let x = 0; x < grid.width; x++) {
          const inside =
            x >= rect.x0 && x < rect.x1 && y >= rect.y0 && y < rect.y1;
          const o = (y * grid.width + x) * 4;
          expect([...got.subarray(o, o + 4)]).toEqual(
            inside ? [...want.subarray(o, o + 4)] : [0, 0, 0, 0],
          );
        }
    }
  });

  it("paints whole degrees, fractions, no data and out-of-range values as the original", () => {
    const bands = RASTER_TEMPLATE_DEFAULTS.slope.bands;
    const rand = lcg(3);
    const values = new Float32Array(4000);
    for (let i = 0; i < values.length; i++) {
      const r = rand();
      values[i] =
        r < 0.7
          ? Math.floor(rand() * 91)
          : r < 0.8
            ? rand() * 91
            : r < 0.9
              ? -32768
              : 90 + rand() * 40 - 20;
    }
    const grid = { values, width: 100, height: 40 };
    expect(slopePixels(grid, bands)).toEqual(originalSlope(grid, bands));
  });

  // Mutation: change the formula written out in decodeTerrarium (a constant,
  // or `/ 256` to `>> 8`) and some pixel differs.
  it("decodes a terrarium pixel with the shared rule, to the Float32", () => {
    const greens = [0, 1, 4, 127, 128, 254, 255];
    const rgba = new Uint8ClampedArray(256 * greens.length * 256 * 4);
    const want = new Float32Array(rgba.length / 4);
    let i = 0;
    for (let r = 0; r < 256; r++)
      for (const g of greens)
        for (let b = 0; b < 256; b++, i++) {
          rgba.set([r, g, b, 255], i * 4);
          want[i] = demMetresFromRgb(r, g, b);
        }
    const got = decodeTerrarium(rgba, want.length, 1).values;
    // Counted rather than compared whole: a diff that long is slow to print.
    expect(got.filter((v, k) => v !== want[k]).length).toBe(0);
  });
});

describe("resampleGrid", () => {
  // A hillshade-like grid: grey with alpha, some pixels clear.
  const W = 40;
  const H = 64;
  const rand = lcg(11);
  const grid = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const g = Math.floor(rand() * 256);
    const clear = rand() < 0.1;
    grid.set([g, g, g, clear ? 0 : 60 + Math.floor(rand() * 195)], i * 4);
  }
  const place = { scaleX: 3.3, scaleY: 3.1, offsetX: 5.4, offsetY: 7.9 };
  const outW = 90;
  const outH = 150;

  // The point of the whole design: a strip of the map is the same bytes as
  // the same rows of the whole map, from a grid that holds only the rows it
  // needs. Mutation: compute the source row from a strip-relative output row.
  for (const smooth of [true, false]) {
    it(`gives a strip the whole map's rows (${smooth ? "bilinear" : "nearest"})`, () => {
      const whole = resampleGrid(grid, W, H, 0, place, smooth, outW, 0, outH);
      // Rows 48..99 of the map read grid rows ~ 22..40 at most; give the
      // strip's grid only rows 16..47.
      const row0 = 16;
      const part = grid.slice(row0 * W * 4, 48 * W * 4);
      const strip = resampleGrid(
        part,
        W,
        32,
        row0,
        place,
        smooth,
        outW,
        48,
        52,
      );
      expect(strip).toEqual(whole.slice(48 * outW * 4, 100 * outW * 4));
    });
  }

  it("leaves a region the grid has no pixel for clear, and never writes colour there", () => {
    const clear = new Uint8ClampedArray(W * H * 4);
    expect(
      resampleGrid(clear, W, H, 0, place, true, outW, 0, outH).every(
        (v) => v === 0,
      ),
    ).toBe(true);
  });

  // The four-pixel blend resampleGrid was first written as, kept here so the
  // separable one is checked against it.
  function fourPixelBilinear(
    src: Uint8ClampedArray,
    srcW: number,
    srcH: number,
    p: typeof place,
    w: number,
    h: number,
  ) {
    const out = new Uint8ClampedArray(w * h * 4);
    const c = (v: number, hi: number) => Math.min(hi, Math.max(0, v));
    for (let r = 0; r < h; r++) {
      const v = (r + 0.5) / p.scaleY + p.offsetY - 0.5;
      const y0 = Math.floor(v);
      const fy = v - y0;
      for (let px = 0; px < w; px++) {
        const u = (px + 0.5) / p.scaleX + p.offsetX - 0.5;
        const x0 = Math.floor(u);
        const fx = u - x0;
        const at = (x: number, y: number) =>
          (c(y, srcH - 1) * srcW + c(x, srcW - 1)) * 4;
        const i00 = at(x0, y0);
        const i10 = at(x0 + 1, y0);
        const i01 = at(x0, y0 + 1);
        const i11 = at(x0 + 1, y0 + 1);
        const w00 = (1 - fx) * (1 - fy) * src[i00 + 3]!;
        const w10 = fx * (1 - fy) * src[i10 + 3]!;
        const w01 = (1 - fx) * fy * src[i01 + 3]!;
        const w11 = fx * fy * src[i11 + 3]!;
        const alpha = w00 + w10 + w01 + w11;
        if (alpha <= 0) continue;
        const o = (r * w + px) * 4;
        out[o] =
          out[o + 1] =
          out[o + 2] =
            (w00 * src[i00]! +
              w10 * src[i10]! +
              w01 * src[i01]! +
              w11 * src[i11]!) /
            alpha;
        out[o + 3] = alpha;
      }
    }
    return out;
  }

  // Blending each grid row across first groups the sums differently, which
  // could move a byte only where a value sits within ~1e-13 of a rounding
  // tie; on these grids, none does. Mutation: swap the weights of the two
  // rows (gy and fy), or keep the upper row when moving down a grid row.
  it("blends as the four-pixel bilinear, edges, exact scales and clear pixels included", () => {
    for (const p of [
      place,
      { scaleX: 2, scaleY: 2, offsetX: 0, offsetY: 0 },
      { scaleX: 1.99998, scaleY: 1.99996, offsetX: -0.7, offsetY: 3.2 },
      { scaleX: 0.8, scaleY: 1.5, offsetX: 1.1, offsetY: 2.6 },
    ]) {
      expect(resampleGrid(grid, W, H, 0, p, true, outW, 0, outH)).toEqual(
        fourPixelBilinear(grid, W, H, p, outW, outH),
      );
    }
  });

  it("reads a flat grey grid back as that grey where it is opaque", () => {
    const flat = new Uint8ClampedArray(W * H * 4).fill(200);
    const out = resampleGrid(flat, W, H, 0, place, true, 20, 10, 10);
    expect([...out.slice(0, 4)]).toEqual([200, 200, 200, 200]);
  });
});

describe("demBlockRows", () => {
  // Mutation: set DEM_HALO_TILE_ROWS to 0. A strip whose first rows sit at a
  // tile's top would then shade its first row from a clamped edge, a seam
  // the e2e seam check only meets when the strips happen to line up so.
  it("reaches a tile row beyond every row a strip reads, wherever the strip falls", () => {
    for (let phase = 0; phase < 40; phase++) {
      const place = {
        scaleX: 2,
        scaleY: 2.01,
        offsetX: 0,
        offsetY: phase * 6.3,
      };
      for (let from = 400; from < 1200; from += 16) {
        const to = from + 432;
        const { r0, r1 } = demBlockRows(from, to, place, 40);
        const first = Math.floor(
          (from + 0.5) / place.scaleY + place.offsetY - 0.5,
        );
        const last =
          Math.floor((to - 0.5) / place.scaleY + place.offsetY - 0.5) + 1;
        // The hillshade of the first and last row read their neighbours.
        // so each needs a row of its own beyond it in the block, unless the
        // block is the grid's own edge.
        if (r0 > 0) expect(r0 * 256).toBeLessThanOrEqual(first - 2);
        if (r1 < 39) expect((r1 + 1) * 256).toBeGreaterThanOrEqual(last + 3);
      }
    }
  });

  it("clamps to the grid", () => {
    expect(
      demBlockRows(0, 100, { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 3 }, 2),
    ).toEqual({ r0: 0, r1: 1 });
  });
});
