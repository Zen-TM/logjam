import { describe, expect, it } from "vitest";
import {
  lat2tileY,
  RASTER_TEMPLATE_DEFAULTS,
  tileY2lat,
  DEM_NO_DATA_BELOW,
  parseRgbaHex,
} from "@logjam/shared";
import {
  decodeTerrarium,
  hillshadePixels,
  nswContourZoom,
  slopePixels,
  type DemGrid,
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
  // Mutation: drop the minzoom check, and a 1:250 000 print (display zoom
  // about 10.8 here) draws and credits 50 m lines the map never shows.
  it("reads no contours where the map draws none", () => {
    expect(nswContourZoom(10.8, 12)).toBeNull();
    expect(nswContourZoom(11, 13)).toBe(13);
    // The archive stops at z14; deeper prints stretch it.
    expect(nswContourZoom(14.3, 16)).toBe(14);
  });
});
