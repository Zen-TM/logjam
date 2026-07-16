import { describe, it, expect } from "vitest";
import {
  passesFilters,
  hasActiveFilters,
  activeFilterCount,
  reconcileCustomFilters,
  emptyFilters,
} from "./canyonUtils";
import type { TCanyon, TFilters } from "./canyonUtils";
import type { TripLogCustomFieldDef } from "@logjam/shared";

// Override type permits null on any field so tests can simulate canyons with
// missing values (the API types them non-null, but filters must handle gaps).
function canyon(
  overrides: Partial<{ [K in keyof TCanyon]: TCanyon[K] | null }> = {},
): TCanyon {
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

describe("passesFilters — shared by me", () => {
  it("keeps canyons with at least one share, drops the rest", () => {
    const f = filters({ shared_by_me: true });
    expect(passesFilters(canyon({ _count: { tripLogLinks: 0, shares: 2 } }), f, true)).toBe(true);
    expect(passesFilters(canyon({ _count: { tripLogLinks: 0, shares: 0 } }), f, true)).toBe(false);
    expect(passesFilters(canyon(), f, true)).toBe(false); // _count absent
  });

  it("is inactive by default (keeps everything)", () => {
    const f = filters();
    expect(passesFilters(canyon(), f, true)).toBe(true);
    expect(hasActiveFilters(f)).toBe(false);
  });

  it("counts as an active filter when on", () => {
    expect(activeFilterCount(filters({ shared_by_me: true }))).toBe(1);
  });
});

describe("passesFilters — completion", () => {
  const done = canyon({ _count: { tripLogLinks: 3, shares: 0 } });
  const notDone = canyon({ _count: { tripLogLinks: 0, shares: 0 } });

  it("done keeps owned canyons with at least one linked trip", () => {
    const f = filters({ completion: "done" });
    expect(passesFilters(done, f, true)).toBe(true);
    expect(passesFilters(notDone, f, true)).toBe(false);
  });

  it("not_done keeps owned canyons with no linked trips", () => {
    const f = filters({ completion: "not_done" });
    expect(passesFilters(notDone, f, true)).toBe(true);
    expect(passesFilters(done, f, true)).toBe(false);
  });

  it("treats a canyon with one trip as done (boundary)", () => {
    const one = canyon({ _count: { tripLogLinks: 1, shares: 0 } });
    expect(passesFilters(one, filters({ completion: "done" }), true)).toBe(true);
    expect(passesFilters(one, filters({ completion: "not_done" }), true)).toBe(
      false,
    );
  });

  // A trip can only link to its own owner's canyons (the API enforces
  // ownerId in resolveTripCanyonIds), so tripLogLinks on a canyon shared WITH
  // the viewer counts the OWNER's trips. The viewer has never done it.
  it("never marks a shared canyon done, whatever the owner's count says", () => {
    expect(passesFilters(done, filters({ completion: "done" }), false)).toBe(
      false,
    );
    expect(passesFilters(done, filters({ completion: "not_done" }), false)).toBe(
      true,
    );
  });

  it("treats an absent _count as not done", () => {
    expect(passesFilters(canyon(), filters({ completion: "done" }), true)).toBe(
      false,
    );
    expect(
      passesFilters(canyon(), filters({ completion: "not_done" }), true),
    ).toBe(true);
  });

  it("ignores include_unknowns — zero trips is an answer, not a gap", () => {
    const f = filters({ completion: "done", include_unknowns: true });
    expect(passesFilters(notDone, f, true)).toBe(false);
    expect(passesFilters(canyon(), f, true)).toBe(false);
  });

  it("is inactive by default and counts as one active filter when set", () => {
    expect(passesFilters(done, filters(), true)).toBe(true);
    expect(passesFilters(notDone, filters(), true)).toBe(true);
    expect(hasActiveFilters(filters())).toBe(false);
    expect(activeFilterCount(filters({ completion: "done" }))).toBe(1);
    expect(activeFilterCount(filters({ completion: "any" }))).toBe(0);
  });

  it("ANDs with other filters rather than replacing them", () => {
    const f = filters({ completion: "not_done", v_grade: [1, 3] });
    expect(passesFilters(canyon({ vGrade: 2, _count: { tripLogLinks: 0, shares: 0 } }), f, true)).toBe(true);
    // right grade, but already done
    expect(passesFilters(canyon({ vGrade: 2, _count: { tripLogLinks: 1, shares: 0 } }), f, true)).toBe(false);
    // not done, but out of grade range
    expect(passesFilters(canyon({ vGrade: 6, _count: { tripLogLinks: 0, shares: 0 } }), f, true)).toBe(false);
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

describe("passesFilters — custom fields", () => {
  function withCustom(customFields: Record<string, unknown>): TCanyon {
    return canyon({ attributes: { customFields } });
  }

  it("text filter matches case-insensitive substring", () => {
    const f = filters({ custom: { water: { kind: "text", value: "HIGH" } } });
    expect(passesFilters(withCustom({ water: "Very high flow" }), f, true)).toBe(true);
    expect(passesFilters(withCustom({ water: "low" }), f, true)).toBe(false);
  });

  it("number filter applies Less than / More than / Exactly", () => {
    const less = filters({ custom: { size: { kind: "number", op: "Less than", value: 5 } } });
    expect(passesFilters(withCustom({ size: 4 }), less, true)).toBe(true);
    expect(passesFilters(withCustom({ size: 5 }), less, true)).toBe(false);

    const more = filters({ custom: { size: { kind: "number", op: "More than", value: 5 } } });
    expect(passesFilters(withCustom({ size: 6 }), more, true)).toBe(true);
    expect(passesFilters(withCustom({ size: 5 }), more, true)).toBe(false);

    const exact = filters({ custom: { size: { kind: "number", op: "Exactly", value: 5 } } });
    expect(passesFilters(withCustom({ size: 5 }), exact, true)).toBe(true);
    expect(passesFilters(withCustom({ size: 4 }), exact, true)).toBe(false);
  });

  it("number filter works for float values", () => {
    const f = filters({ custom: { depth: { kind: "number", op: "More than", value: 2.5 } } });
    expect(passesFilters(withCustom({ depth: 2.75 }), f, true)).toBe(true);
    expect(passesFilters(withCustom({ depth: 2.25 }), f, true)).toBe(false);
  });

  it("date filter applies start bound and inclusive end day", () => {
    const f = filters({ custom: { last_visit: { kind: "date", range: ["2026-02-01", "2026-06-16"] } } });
    expect(passesFilters(withCustom({ last_visit: "2026-03-01" }), f, true)).toBe(true);
    expect(passesFilters(withCustom({ last_visit: "2026-06-16" }), f, true)).toBe(true);
    expect(passesFilters(withCustom({ last_visit: "2026-01-15" }), f, true)).toBe(false);
  });

  it("boolean filter matches exact truthiness", () => {
    const yes = filters({ custom: { done: { kind: "boolean", value: true } } });
    expect(passesFilters(withCustom({ done: true }), yes, true)).toBe(true);
    expect(passesFilters(withCustom({ done: false }), yes, true)).toBe(false);

    const no = filters({ custom: { done: { kind: "boolean", value: false } } });
    expect(passesFilters(withCustom({ done: false }), no, true)).toBe(true);
    expect(passesFilters(withCustom({ done: true }), no, true)).toBe(false);
  });

  it("hides canyons missing a custom value unless include_unknowns is on", () => {
    const off = filters({ custom: { size: { kind: "number", op: "More than", value: 3 } } });
    expect(passesFilters(withCustom({}), off, true)).toBe(false);
    const on = filters({
      custom: { size: { kind: "number", op: "More than", value: 3 } },
      include_unknowns: true,
    });
    expect(passesFilters(withCustom({}), on, true)).toBe(true);
  });
});

describe("activeFilterCount — custom fields", () => {
  it("counts each active custom filter once", () => {
    const f = filters({
      v_grade: [2, 5],
      custom: {
        water: { kind: "text", value: "high" },
        size: { kind: "number", op: "More than", value: 3 },
      },
    });
    expect(activeFilterCount(f)).toBe(3);
  });

  it("is unaffected by an empty custom map", () => {
    expect(activeFilterCount(filters({ custom: {} }))).toBe(0);
  });
});

describe("reconcileCustomFilters", () => {
  const defs: TripLogCustomFieldDef[] = [
    { key: "size", label: "Group size", type: "integer" },
    { key: "water", label: "Water level", type: "string" },
  ];

  it("drops a filter whose definition no longer exists", () => {
    const f = filters({
      custom: {
        size: { kind: "number", op: "More than", value: 3 },
        gone: { kind: "text", value: "x" },
      },
    });
    const out = reconcileCustomFilters(f, defs);
    expect(Object.keys(out.custom)).toEqual(["size"]);
  });

  it("drops a filter whose kind no longer matches the field type", () => {
    // 'water' is now a string field, but a stale numeric filter persists.
    const f = filters({
      custom: { water: { kind: "number", op: "Exactly", value: 1 } },
    });
    const out = reconcileCustomFilters(f, defs);
    expect(out.custom).toEqual({});
  });

  it("returns the same reference when nothing is pruned", () => {
    const f = filters({
      custom: { size: { kind: "number", op: "More than", value: 3 } },
    });
    expect(reconcileCustomFilters(f, defs)).toBe(f);
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
