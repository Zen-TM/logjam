// Decoder check against a REAL tile, not a synthetic one: the fixture is the
// z13 terrarium tile over Blue Gum Forest / Grose Valley, committed beside this
// test (`__fixtures__/terrarium-z13-7516-4911.png`).
//
// Expected heights come from an independent decode of the same file (Python
// zlib + the PNG spec's filters), not from this decoder — a self-referential
// expectation would pass on a decoder that unfilters wrongly and consistently.
// Sanity anchors them too: the Grose sits between ~700 m and ~1100 m.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEM_TILE_SIZE, demSampleValue } from "@logjam/shared";

import { decodeDemPng } from "./demPng";

const TILE = new Uint8Array(
  readFileSync(join(__dirname, "__fixtures__/terrarium-z13-7516-4911.png")),
);

describe("decodeDemPng", () => {
  it("decodes a real terrarium tile to the heights an independent decoder reads", () => {
    const elevations = decodeDemPng(TILE);
    expect(elevations).toHaveLength(DEM_TILE_SIZE * DEM_TILE_SIZE);
    expect(elevations[0]).toBeCloseTo(1031, 3);
    expect(elevations[128 * 256 + 128]).toBeCloseTo(1016, 3);
    expect(elevations[255 * 256 + 255]).toBeCloseTo(902, 3);
    expect(elevations[200 * 256 + 37]).toBeCloseTo(1014, 3);
  });

  it("reads the whole tile as plausible terrain, not noise", () => {
    // The failure this catches is a filter bug: get Paeth or Average wrong and
    // individual pixels still land in range while the surface goes to hash, so
    // the min/max over all 65 536 of them is the assertion that bites.
    const elevations = decodeDemPng(TILE);
    let min = Infinity;
    let max = -Infinity;
    for (const value of elevations) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    expect(min).toBeCloseTo(737, 3);
    expect(max).toBeCloseTo(1063, 3);
  });

  it("refuses anything that is not the encoding it was written for", () => {
    expect(() => decodeDemPng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(
      /not a PNG/,
    );
    const truncated = TILE.slice(0, 40);
    expect(() => decodeDemPng(truncated)).toThrow();
  });

  it("hands no-data pixels to the shared null rule", () => {
    // Terrarium's ocean/no-data floor. The decoder passes it through as the
    // number it is; `demSampleValue` is what turns it into "we don't know".
    expect(demSampleValue(new Float32Array([-32768]), 0)).toBeNull();
    expect(demSampleValue(decodeDemPng(TILE), 0)).toBeCloseTo(1031, 3);
  });
});
