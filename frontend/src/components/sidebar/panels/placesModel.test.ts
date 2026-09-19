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
  placeVerbs,
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

describe("placeVerbs", () => {
  const ids = (surface: "row" | "detail", owned: boolean) =>
    placeVerbs(surface, owned).map((verb) => verb.id);

  // The rule the ways pages learned the hard way (DESIGN.md §7): both ⋯ lists
  // act on the same thing, so they carry the same verbs. Open is the one
  // exception — the page you would open is the page you are on.
  it("gives the row and the page the same verbs, bar the ones each cannot honour", () => {
    const row = ids("row", true);
    const detail = ids("detail", true);
    expect(row[0]).toBe("open");
    expect(detail).not.toContain("open");
    // What is left over each way is only the form-opening pair, which a menu
    // cannot hold and a row hands to the page by opening it.
    expect(row.filter((id) => !detail.includes(id))).toEqual(["open"]);
    expect(detail.filter((id) => !row.includes(id))).toEqual(["edit", "logTrip"]);
  });

  it("never offers to edit or delete a place someone shared with you", () => {
    for (const surface of ["row", "detail"] as const) {
      const shared = ids(surface, false);
      expect(shared).not.toContain("edit");
      expect(shared).not.toContain("delete");
      expect(shared).not.toContain("share");
      expect(shared).toContain("copy");
      expect(shared).toContain("remove");
    }
  });

  // Copy first, then unshare: a failure between them leaves the user with both
  // rather than neither, so the combined verb sits with the parting ones.
  it("puts the verbs that end the share below the rule, and marks only Delete destructive", () => {
    const shared = placeVerbs("detail", false);
    expect(shared.filter((verb) => verb.separated).map((verb) => verb.id)).toEqual([
      "copyAndRemove",
      "remove",
    ]);
    expect(shared.some((verb) => verb.danger)).toBe(false);
    const owned = placeVerbs("detail", true);
    expect(owned.filter((verb) => verb.danger).map((verb) => verb.id)).toEqual(["delete"]);
  });
});
