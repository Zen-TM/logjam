import { describe, expect, it } from "vitest";

import {
  distinctTripTypes,
  filterTrips,
  hasActiveTripFilter,
  NO_TYPE_FILTER_VALUE,
  tripMatchesFilter,
  type FilterableTrip,
} from "./tripFilter.js";

function trip(overrides: Partial<FilterableTrip> = {}): FilterableTrip {
  return {
    date: "2026-03-15T00:00:00.000Z",
    displayName: null,
    types: ["canyoning"],
    canyons: [{ name: "Claustral" }],
    ...overrides,
  };
}

describe("tripMatchesFilter", () => {
  it("matches everything when no criteria are set", () => {
    expect(tripMatchesFilter(trip(), {})).toBe(true);
  });

  it("searches canyon names case-insensitively", () => {
    expect(tripMatchesFilter(trip(), { search: "claus" })).toBe(true);
    expect(tripMatchesFilter(trip(), { search: "CLAUS" })).toBe(true);
    expect(tripMatchesFilter(trip(), { search: "ranon" })).toBe(false);
  });

  it("searches the trip's own display name", () => {
    const named = trip({ displayName: "Birthday descent", canyons: [] });
    expect(tripMatchesFilter(named, { search: "birthday" })).toBe(true);
    expect(tripMatchesFilter(named, { search: "claustral" })).toBe(false);
  });

  it("ignores a whitespace-only search", () => {
    expect(tripMatchesFilter(trip({ canyons: [] }), { search: "   " })).toBe(true);
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
      trip({ canyons: [{ name: "Ranon" }] }),
      trip({ canyons: [{ name: "Claustral" }] }),
      trip({ canyons: [{ name: "Ranon" }] }),
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
