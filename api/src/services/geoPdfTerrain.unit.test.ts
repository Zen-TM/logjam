import { describe, expect, it } from "vitest";
import { lat2tileY, RASTER_TEMPLATE_DEFAULTS } from "@logjam/shared";
import {
  decodeTerrarium,
  hillshadePixels,
  slopePixels,
  type DemGrid,
} from "./geoPdfTerrain";

// Made-up grids: a plane tilted a known way, at Katoomba's latitude.
const SIZE = 8;
const ZOOM = 15;
const TILE_Y = lat2tileY(-33.7, ZOOM);
// One z15 pixel here is about 4 m across.
const PIXEL_M = 4;

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
  const facingLight = plane((x, y) => (x + y) * 0.3 * PIXEL_M);
  const facingAway = plane((x, y) => -(x + y) * 0.3 * PIXEL_M);

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

  // Mutation: drop the clamp on the derivative. MapLibre stores it in a byte,
  // so past ~30° every slope shades alike, and the print must too.
  it("shades every steep face alike, as the screen does", () => {
    const steep = hillshadePixels(
      plane((x) => x * 2 * PIXEL_M),
      ZOOM,
      TILE_Y,
    );
    const cliff = hillshadePixels(
      plane((x) => x * 6 * PIXEL_M),
      ZOOM,
      TILE_Y,
    );
    expect(centre(cliff)).toEqual(centre(steep));
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
    expect([...pixels.slice(0, 4)]).toEqual(
      [1, 3, 5, 7].map((at) => parseInt(first.colour.slice(at, at + 2), 16)),
    );
    // Under the first band, and no data: both clear.
    expect(first.fromDeg).toBeGreaterThan(0);
    expect(pixels[7]).toBe(0);
    expect(pixels[11]).toBe(0);
  });
});

describe("decodeTerrarium", () => {
  it("reads a pixel no tile was drawn onto as no data", () => {
    const { values } = decodeTerrarium(new Uint8ClampedArray(4), 1, 1);
    expect(values[0]).toBeLessThanOrEqual(-32000);
  });
});
