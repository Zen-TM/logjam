import { describe, expect, it } from "vitest";
import {
  lat2tileY,
  NSW_5M,
  NSW_SLOPE,
  RASTER_TEMPLATE_DEFAULTS,
  type SharpenedArea,
  type TileCoord,
  tileY2lat,
  DEM_NO_DATA_BELOW,
  parseRgbaHex,
} from "@logjam/shared";
import {
  areasOnPage,
  contourTilesBySource,
  decodeTerrarium,
  hillshadePixels,
  nswContourZoom,
  slopePixels,
  STATEWIDE,
  terrainCreditLines,
  terrainGrid,
  terrainReadKey,
  terrainReadZoom,
  terrainTileReader,
  terrainTileReads,
  type DemGrid,
  type TerrainTileRead,
} from "./geoPdfTerrain";

// Made-up grids: a plane tilted a known way, at Katoomba's latitude.
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
  // at Katoomba. Mutation: gate on the print's 256-based style zoom, one
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
    const greys = new Set<number>();
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

  // Mutation: word an area's line from every layer the page drew.
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
  });
});
