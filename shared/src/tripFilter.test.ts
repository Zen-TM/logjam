import { describe, expect, it } from "vitest";

import {
  activeTripFilterCount,
  distinctTripTypes,
  filterTrips,
  hasActiveTripFilter,
  NO_TYPE_FILTER_VALUE,
  sortTrips,
  tripFilterFieldDefs,
  tripMatchesFilter,
  type FilterableTrip,
} from "./tripFilter.js";
import type { ScopedCustomFieldDef } from "./tripLogFields.js";

function trip(overrides: Partial<FilterableTrip> = {}): FilterableTrip {
  return {
    date: "2026-03-15T00:00:00.000Z",
    displayName: null,
    types: ["canyoning"],
    places: [{ name: "Claustral" }],
    ...overrides,
  };
}

describe("tripMatchesFilter", () => {
  it("matches everything when no criteria are set", () => {
    expect(tripMatchesFilter(trip(), {})).toBe(true);
  });

  it("searches place names case-insensitively", () => {
    expect(tripMatchesFilter(trip(), { search: "claus" })).toBe(true);
    expect(tripMatchesFilter(trip(), { search: "CLAUS" })).toBe(true);
    expect(tripMatchesFilter(trip(), { search: "ranon" })).toBe(false);
  });

  it("searches the trip's own display name", () => {
    const named = trip({ displayName: "Birthday descent", places: [] });
    expect(tripMatchesFilter(named, { search: "birthday" })).toBe(true);
    expect(tripMatchesFilter(named, { search: "claustral" })).toBe(false);
  });

  it("ignores a whitespace-only search", () => {
    expect(tripMatchesFilter(trip({ places: [] }), { search: "   " })).toBe(true);
  });

  it("treats both date bounds as inclusive", () => {
    const t = trip({ date: "2026-03-15T00:00:00.000Z" });
    expect(tripMatchesFilter(t, { dateFrom: "2026-03-15" })).toBe(true);
    expect(tripMatchesFilter(t, { dateTo: "2026-03-15" })).toBe(true);
    expect(tripMatchesFilter(t, { dateFrom: "2026-03-16" })).toBe(false);
    expect(tripMatchesFilter(t, { dateTo: "2026-03-14" })).toBe(false);
  });

  it("filters by an explicit type", () => {
    expect(tripMatchesFilter(trip(), { type: "canyoning" })).toBe(true);
    expect(tripMatchesFilter(trip(), { type: "bushwalking" })).toBe(false);
  });

  it("filters typeless trips separately from 'any type'", () => {
    const typeless = trip({ types: [] });
    expect(tripMatchesFilter(typeless, { type: NO_TYPE_FILTER_VALUE })).toBe(true);
    expect(tripMatchesFilter(trip(), { type: NO_TYPE_FILTER_VALUE })).toBe(false);
    expect(tripMatchesFilter(typeless, { type: "" })).toBe(true);
  });

  it("requires every axis to pass", () => {
    const t = trip({ date: "2026-03-15T00:00:00.000Z" });
    expect(
      tripMatchesFilter(t, { search: "claustral", dateFrom: "2026-01-01", type: "canyoning" }),
    ).toBe(true);
    expect(
      tripMatchesFilter(t, { search: "claustral", dateFrom: "2026-01-01", type: "packrafting" }),
    ).toBe(false);
  });
});

describe("filterTrips", () => {
  it("keeps input order", () => {
    const trips = [
      trip({ places: [{ name: "Ranon" }] }),
      trip({ places: [{ name: "Claustral" }] }),
      trip({ places: [{ name: "Ranon" }] }),
    ];
    expect(filterTrips(trips, { search: "ranon" })).toEqual([trips[0], trips[2]]);
  });
});

describe("hasActiveTripFilter", () => {
  it("is false for empty or whitespace-only criteria", () => {
    expect(hasActiveTripFilter({})).toBe(false);
    expect(hasActiveTripFilter({ search: "  ", dateFrom: "", dateTo: "", type: "" })).toBe(false);
  });

  it("is true when any axis narrows", () => {
    expect(hasActiveTripFilter({ search: "x" })).toBe(true);
    expect(hasActiveTripFilter({ dateFrom: "2026-01-01" })).toBe(true);
    expect(hasActiveTripFilter({ dateTo: "2026-01-01" })).toBe(true);
    expect(hasActiveTripFilter({ type: NO_TYPE_FILTER_VALUE })).toBe(true);
  });
});

describe("attribute filters", () => {
  const deep = trip({ customFields: { rope_length: 60, wetsuit: true } });

  it("filters on a trip's own answers", () => {
    expect(
      tripMatchesFilter(deep, {
        custom: { rope_length: { kind: "number", op: "More than", value: 30 } },
      }),
    ).toBe(true);
    expect(
      tripMatchesFilter(deep, {
        custom: { rope_length: { kind: "number", op: "Less than", value: 30 } },
      }),
    ).toBe(false);
  });

  // Most trips answer most fields not at all, so the default has to be stated
  // rather than assumed: an attribute filter narrows to trips that ANSWERED.
  it("drops a trip that never answered, unless unknowns are included", () => {
    const bare = trip({ customFields: {} });
    const criteria = {
      custom: { rope_length: { kind: "number" as const, op: "More than" as const, value: 30 } },
    };
    expect(tripMatchesFilter(bare, criteria)).toBe(false);
    expect(tripMatchesFilter(bare, { ...criteria, includeUnknowns: true })).toBe(true);
  });

  it("is ignored by a caller that passes no customFields at all", () => {
    expect(tripMatchesFilter(trip(), {})).toBe(true);
  });

  it("counts toward the active-filter tally, while includeUnknowns does not", () => {
    expect(hasActiveTripFilter({ custom: { wetsuit: { kind: "boolean", value: true } } })).toBe(true);
    expect(hasActiveTripFilter({ includeUnknowns: true })).toBe(false);
    expect(
      activeTripFilterCount({
        search: "x",
        dateFrom: "2026-01-01",
        dateTo: "2026-02-01",
        custom: { wetsuit: { kind: "boolean", value: true } },
        includeUnknowns: true,
      }),
      // search + ONE date axis + one attribute. A from/to pair is one axis.
    ).toBe(3);
  });
});

describe("sortTrips", () => {
  const trips = [
    trip({ date: "2026-03-15T00:00:00.000Z", displayName: "middle" }),
    trip({ date: "2019-01-02T00:00:00.000Z", displayName: "oldest" }),
    trip({ date: "2026-09-01T00:00:00.000Z", displayName: "newest" }),
  ];

  it("runs newest or oldest first", () => {
    expect(sortTrips(trips, "newest").map((t) => t.displayName)).toEqual(["newest", "middle", "oldest"]);
    expect(sortTrips(trips, "oldest").map((t) => t.displayName)).toEqual(["oldest", "middle", "newest"]);
  });

  it("sorts a copy, so the caller's list is untouched", () => {
    const before = [...trips];
    sortTrips(trips, "oldest");
    expect(trips).toEqual(before);
  });

  it("keeps trips sharing a date in the order they arrived", () => {
    const sameDay = [
      trip({ date: "2026-03-15T00:00:00.000Z", displayName: "first" }),
      trip({ date: "2026-03-15T00:00:00.000Z", displayName: "second" }),
    ];
    expect(sortTrips(sameDay, "newest").map((t) => t.displayName)).toEqual(["first", "second"]);
    expect(sortTrips(sameDay, "oldest").map((t) => t.displayName)).toEqual(["first", "second"]);
  });
});

describe("distinctTripTypes", () => {
  it("dedupes and sorts", () => {
    const types = distinctTripTypes([
      trip({ types: ["packrafting", "canyoning"] }),
      trip({ types: ["canyoning"] }),
      trip({ types: [] }),
    ]);
    expect(types).toEqual(["canyoning", "packrafting"]);
  });
});

describe("tripFilterFieldDefs", () => {
  const def = (key: string, tripTypes: string[], appliesToAllTypes = false): ScopedCustomFieldDef => ({
    key,
    label: key,
    type: "string",
    placeTypeIds: [],
    tripTypes,
    appliesToAllTypes,
  });
  const defs = [def("party", [], true), def("rope", ["canyoning"]), def("paddle", ["packrafting"]), def("depth", ["caving"])];
  const trips = [
    { types: ["canyoning"], customFields: { rope: 60 } },
    { types: ["packrafting"], customFields: { paddle: "yes" } },
    // Retagged since: still holds a caving answer.
    { types: [], customFields: { depth: 12 } },
  ];
  const keys = (type: string) => tripFilterFieldDefs(defs, trips, type).map((d) => d.key);

  it("offers every loaded trip's attributes with no activity chosen", () => {
    expect(keys("")).toEqual(["party", "rope", "paddle", "depth"]);
  });

  it("follows the chosen activity, case-insensitively through tripFieldDefs", () => {
    expect(keys("canyoning")).toEqual(["party", "rope"]);
  });

  it("keeps an attribute an untagged trip answered under No type", () => {
    expect(keys(NO_TYPE_FILTER_VALUE)).toEqual(["party", "depth"]);
  });
});
