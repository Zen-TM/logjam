import { RASTER_TEMPLATE_DEFAULTS } from "@logjam/shared";
import { describe, expect, it } from "vitest";
import {
  hillshadePixels,
  resampleGrid,
  slopePixels,
  type GridPlacement,
} from "./terrain";
import { bandRows, runTerrainBand, type TerrainBand } from "./terrainJobs";

// A DEM block two tiles across and three down, made up, with holes.
const W = 512;
const H = 768;
const ZOOM = 15;
const TILE_Y = 19650;
const place: GridPlacement = {
  scaleX: 2.3,
  scaleY: 2.3,
  offsetX: 3.2,
  offsetY: 40.7,
};
const OUT_W = 400;

function heights() {
  let s = 11;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const values = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      values[y * W + x] =
        400 + 80 * Math.sin(x / 17) * Math.cos(y / 11) + rand() * 4;
  values[300 * W + 40] = -32768;
  return values;
}

function slopes() {
  const v = heights();
  for (let i = 0; i < v.length; i++) v[i] = Math.abs(Math.round(v[i]! % 60));
  return v;
}

/** The strip done in one piece, with the functions bands are built from. */
function whole(kind: "hillshade" | "slope", values: Float32Array) {
  const grid = { values, width: W, height: H };
  const pixels =
    kind === "hillshade"
      ? hillshadePixels(grid, ZOOM, TILE_Y)
      : slopePixels(grid, RASTER_TEMPLATE_DEFAULTS.slope.bands);
  return (outY: number, outH: number) =>
    resampleGrid(
      pixels,
      W,
      H,
      0,
      place,
      kind === "hillshade",
      OUT_W,
      outY,
      outH,
    );
}

/** The same rows as bands, each from only the DEM rows it reads. */
function inBands(
  kind: "hillshade" | "slope",
  values: Float32Array,
  outY: number,
  heightsOfBands: number[],
) {
  const out: Uint8ClampedArray[] = [];
  let y = outY;
  for (const outH of heightsOfBands) {
    const { from, to } = bandRows(place, 0, H, y, outH);
    const job: TerrainBand = {
      kind,
      values: values.slice(from * W, to * W),
      width: W,
      gridRow0: from,
      blockRow0: 0,
      zoom: ZOOM,
      tileY: TILE_Y,
      bands: RASTER_TEMPLATE_DEFAULTS.slope.bands,
      place,
      smooth: kind === "hillshade",
      outW: OUT_W,
      outY: y,
      outH,
    };
    out.push(runTerrainBand(job));
    y += outH;
  }
  return out;
}

const join = (parts: Uint8ClampedArray[]) => {
  const all = new Uint8ClampedArray(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return all;
};

/** Index of the first byte that differs, or -1 (a deep equal of megabytes is slow). */
const firstDifference = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
  if (a.length !== b.length) return 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
};

describe("terrain bands", () => {
  // Mutation: take the latitude of a band's rows from the band's own first
  // row (drop the `rowOffset` argument in runTerrainBand), or cut the DEM rows
  // a band reads one short (`bandRows`): the bytes differ.
  for (const kind of ["hillshade", "slope"] as const) {
    it(`${kind}: bands side by side are the strip's own bytes`, () => {
      const values = kind === "hillshade" ? heights() : slopes();
      const outY = 300;
      const bands = [170, 1, 256, 173];
      const total = bands.reduce((a, b) => a + b, 0);
      expect(
        firstDifference(
          join(inBands(kind, values, outY, bands)),
          whole(kind, values)(outY, total),
        ),
      ).toBe(-1);
    });
  }

  it("the first and last rows of the block clamp as the whole block's do", () => {
    const values = heights();
    // Rows that reach past both ends of the block.
    const outY = 0;
    const total = Math.floor((H - place.offsetY) * place.scaleY) + 30;
    expect(
      firstDifference(
        join(inBands("hillshade", values, outY, [total])),
        whole("hillshade", values)(outY, total),
      ),
    ).toBe(-1);
  });

  it("reads only the DEM rows it needs", () => {
    const { from, to } = bandRows(place, 0, H, 600, 100);
    expect(to - from).toBeLessThan(H / 4);
    expect(from).toBeGreaterThan(0);
    expect(to).toBeLessThan(H);
  });
});
