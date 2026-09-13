import { describe, expect, it } from "vitest";
import { EMPTY_PLACE_FILTERS, regionEdgesKm, type PlaceFilters } from "@logjam/shared";
import {
  bucketOf,
  clearSheetFilters,
  idRange,
  normaliseBucket,
  placesBounds,
  sheetFilterCount,
  withBucket,
} from "./placesModel";

const filters = (overrides: Partial<PlaceFilters> = {}): PlaceFilters => ({
  ...EMPTY_PLACE_FILTERS,
  custom: {},
  ...overrides,
});

describe("status buckets", () => {
  it("round-trips every chip through the filter", () => {
    for (const bucket of ["all", "todo", "done", "shared"] as const) {
      expect(bucketOf(withBucket(filters(), bucket))).toBe(bucket);
    }
  });

  it("normalises a combination the rail cannot show, so no hidden axis narrows the list", () => {
    const legacy = filters({ ownership: "owned", completion: "any" });
    expect(normaliseBucket(legacy)).toMatchObject({ ownership: "all", completion: "any" });
    const shown = withBucket(filters(), "done");
    expect(normaliseBucket(shown)).toBe(shown);
  });
});

describe("the sheet's filters", () => {
  it("does not count what the rails show", () => {
    const railsOnly = withBucket(filters({ placeTypeId: "t" }), "todo");
    expect(sheetFilterCount(railsOnly)).toBe(0);
    expect(sheetFilterCount({ ...railsOnly, ropewiki: "linked", shared_by_me: true })).toBe(2);
  });

  it("clears its own filters and keeps the rails", () => {
    const set = withBucket(
      filters({ placeTypeId: "t", ropewiki: "linked", custom: { hours: { kind: "text", value: "x" } } }),
      "shared",
    );
    expect(clearSheetFilters(set)).toEqual(withBucket(filters({ placeTypeId: "t" }), "shared"));
  });
});

describe("placesBounds", () => {
  it("is null for nothing", () => {
    expect(placesBounds([])).toBeNull();
  });

  it("gives a single place a useful minimum area", () => {
    const [width, height] = regionEdgesKm(placesBounds([{ latitude: -33.56, longitude: 150.4 }])!);
    expect(width).toBeCloseTo(2, 1);
    expect(height).toBeCloseTo(2, 1);
  });

  it("pads a spread of places by a tenth on each side", () => {
    const box = placesBounds([
      { latitude: -34, longitude: 150 },
      { latitude: -33, longitude: 151 },
    ])!;
    expect(box.south).toBeCloseTo(-34.1);
    expect(box.north).toBeCloseTo(-32.9);
    expect(box.west).toBeCloseTo(149.9);
    expect(box.east).toBeCloseTo(151.1);
  });
});

describe("idRange", () => {
  const ids = ["a", "b", "c", "d"];

  it("selects from the anchor to the clicked row in either direction", () => {
    expect(idRange(ids, "b", "d")).toEqual(["b", "c", "d"]);
    expect(idRange(ids, "d", "b")).toEqual(["b", "c", "d"]);
  });

  it("falls back to the clicked row when there is no anchor in the list", () => {
    expect(idRange(ids, null, "c")).toEqual(["c"]);
    expect(idRange(ids, "gone", "c")).toEqual(["c"]);
  });
});
