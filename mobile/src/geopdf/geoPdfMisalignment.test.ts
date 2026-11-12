import { describe, expect, it } from "vitest";

import { misalignedGeoPdfNotice } from "./geoPdfMisalignment";

// About 9.3 km wide at this latitude.
const bbox: [number, number, number, number] = [150.3, -33.6, 150.4, -33.5];
const view = { west: 150.32, south: -33.58, east: 150.36, north: -33.52 };
const sheet = (residualFraction: number | null, label = "Wollangambe") => ({
  label,
  bbox,
  residualFraction,
});

describe("misalignedGeoPdfNotice", () => {
  // Mutation: compare against the fraction with `<` instead of `<=`, or drop
  // the threshold check entirely.
  it("stays silent for a fit within RESIDUAL_WARN_FRACTION", () => {
    expect(
      misalignedGeoPdfNotice([sheet(0.005), sheet(null)], view),
    ).toBeNull();
  });

  it("names a poorly fitted GeoPDF on screen and how far off it may be", () => {
    expect(misalignedGeoPdfNotice([sheet(0.01)], view)).toBe(
      "Wollangambe may be up to 100 m out of position",
    );
  });

  // Mutation: test the GeoPDF's bbox against something other than the view.
  it("says nothing about a GeoPDF that is not on screen", () => {
    const elsewhere = { west: 151, south: -34, east: 151.1, north: -33.9 };
    expect(misalignedGeoPdfNotice([sheet(0.05)], elsewhere)).toBeNull();
  });

  it("reports the worst of several on screen", () => {
    expect(
      misalignedGeoPdfNotice(
        [sheet(0.01, "Mild"), sheet(0.03, "Worst"), sheet(0.002, "Fine")],
        view,
      ),
    ).toBe("Worst may be up to 280 m out of position");
  });
});
