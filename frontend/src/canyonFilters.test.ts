import { describe, it, expect } from "vitest";
import {
  passesFilters,
  hasActiveFilters,
  activeFilterCount,
  emptyFilters,
} from "./canyonUtils";
import type { TCanyon, TFilters } from "./canyonUtils";

function canyon(overrides: Partial<TCanyon> = {}): TCanyon {
  return {
    id: "c1",
    name: "Empress Canyon",
    latitude: -33.5,
    longitude: 150.3,
    altNames: [],
    vGrade: 3,
    aGrade: 3,
    commitment: 3,
    quality: 3,
    wetsuits: 3,
    numAbseils: 8,
    longestAbseil: 30,
    hours: 4,
    notes: null,
    ropeWikiId: null,
    attributes: {},
    createdAt: "2026-01-15T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  } as unknown as TCanyon;
}

function filters(overrides: Partial<TFilters> = {}): TFilters {
  return { ...emptyFilters, ...overrides };
}

describe("passesFilters — ownership", () => {
  it("owned-only keeps owned, drops shared", () => {
    const f = filters({ ownership: "owned" });
    expect(passesFilters(canyon(), f, true)).toBe(true);
    expect(passesFilters(canyon(), f, false)).toBe(false);
  });

  it("shared-only keeps shared, drops owned", () => {
    const f = filters({ ownership: "shared" });
    expect(passesFilters(canyon(), f, false)).toBe(true);
    expect(passesFilters(canyon(), f, true)).toBe(false);
  });

  it("all keeps both buckets", () => {
    const f = filters({ ownership: "all" });
    expect(passesFilters(canyon(), f, true)).toBe(true);
    expect(passesFilters(canyon(), f, false)).toBe(true);
  });
});

describe("passesFilters — ropewiki link", () => {
  it("linked keeps only canyons with a ropeWikiId", () => {
    const f = filters({ ropewiki: "linked" });
    expect(passesFilters(canyon({ ropeWikiId: 42 }), f, true)).toBe(true);
    expect(passesFilters(canyon({ ropeWikiId: null }), f, true)).toBe(false);
  });

  it("unlinked keeps only canyons without a ropeWikiId", () => {
    const f = filters({ ropewiki: "unlinked" });
    expect(passesFilters(canyon({ ropeWikiId: null }), f, true)).toBe(true);
    expect(passesFilters(canyon({ ropeWikiId: 42 }), f, true)).toBe(false);
  });
});

describe("passesFilters — date range", () => {
  it("created_at start bound excludes earlier canyons", () => {
    const f = filters({ created_at: ["2026-02-01", null] });
    expect(passesFilters(canyon({ createdAt: "2026-03-01T00:00:00.000Z" }), f, true)).toBe(true);
    expect(passesFilters(canyon({ createdAt: "2026-01-01T00:00:00.000Z" }), f, true)).toBe(false);
  });

  it("created_at end bound is inclusive of the whole end day", () => {
    const f = filters({ created_at: [null, "2026-06-16"] });
    expect(passesFilters(canyon({ createdAt: "2026-06-16T18:30:00.000Z" }), f, true)).toBe(true);
    expect(passesFilters(canyon({ createdAt: "2026-06-17T00:00:00.000Z" }), f, true)).toBe(false);
  });

  it("updated_at range filters on the updated timestamp", () => {
    const f = filters({ updated_at: ["2026-05-01", "2026-05-31"] });
    expect(passesFilters(canyon({ updatedAt: "2026-05-15T00:00:00.000Z" }), f, true)).toBe(true);
    expect(passesFilters(canyon({ updatedAt: "2026-06-01T00:00:00.000Z" }), f, true)).toBe(false);
  });

  it("a null-bounded range is treated as inactive", () => {
    const f = filters({ created_at: [null, null] });
    expect(passesFilters(canyon(), f, true)).toBe(true);
  });
});

describe("passesFilters — include_unknowns over new fields", () => {
  it("hides canyons with unknown dates when an active date filter excludes unknowns", () => {
    const f = filters({ created_at: ["2026-02-01", null], include_unknowns: false });
    expect(passesFilters(canyon({ createdAt: null }), f, true)).toBe(false);
  });

  it("keeps canyons with unknown dates when include_unknowns is on", () => {
    const f = filters({ created_at: ["2026-02-01", null], include_unknowns: true });
    expect(passesFilters(canyon({ createdAt: null }), f, true)).toBe(true);
  });
});

describe("activeFilterCount", () => {
  it("is 0 for emptyFilters", () => {
    expect(activeFilterCount(emptyFilters)).toBe(0);
  });

  it("counts each active filter exactly once", () => {
    const f = filters({
      v_grade: [2, 5],
      ownership: "owned",
      ropewiki: "linked",
      created_at: ["2026-01-01", null],
      hours: ["More than", 3],
    });
    expect(activeFilterCount(f)).toBe(5);
  });

  it("does not count a full-range slider or an 'Any' threshold", () => {
    const f = filters({ v_grade: [1, 7], hours: ["Any", 0] });
    expect(activeFilterCount(f)).toBe(0);
  });

  it("does not count name or include_unknowns", () => {
    const f = filters({ name: "empress", include_unknowns: true });
    expect(activeFilterCount(f)).toBe(0);
  });
});

describe("hasActiveFilters", () => {
  it("is false for emptyFilters", () => {
    expect(hasActiveFilters(emptyFilters)).toBe(false);
  });

  it("is true when a name is set even though name is uncounted", () => {
    expect(hasActiveFilters(filters({ name: "empress" }))).toBe(true);
  });

  it("is true when any counted filter is active", () => {
    expect(hasActiveFilters(filters({ ownership: "shared" }))).toBe(true);
  });
});
