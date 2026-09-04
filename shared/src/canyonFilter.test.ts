import { describe, it, expect } from "vitest";

import {
  activeCanyonFilterCount as activeFilterCount,
  COUNTED_FILTER_KEYS,
  UNCOUNTED_FILTER_KEYS,
  canyonMatchesSearch,
  compareCanyons,
  EMPTY_CANYON_FILTERS as emptyFilters,
  hasActiveCanyonFilters as hasActiveFilters,
  isCanyonDoneByViewer,
  isCanyonInArea,
  passesCanyonFilters as passesFilters,
  reconcileCustomFilters,
} from "./canyonFilter.js";
import type { CanyonFilterFields, CanyonFilters as TFilters } from "./canyonFilter.js";
import type { TripLogCustomFieldDef } from "./tripLogFields.js";

// Named TCanyon here because these cases were written against the web canyon
// type; the predicate only ever reads the structural subset.
type TCanyon = CanyonFilterFields & { id: string; latitude: number; longitude: number };

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

// Single source for the completion filter AND the map's completed-marker style.
describe("isCanyonDoneByViewer", () => {
  it("is true for an owned canyon with at least one logged trip", () => {
    expect(
      isCanyonDoneByViewer(canyon({ _count: { tripLogLinks: 3, shares: 0 } }), true),
    ).toBe(true);
  });

  it("is false for an owned canyon with zero trips", () => {
    expect(
      isCanyonDoneByViewer(canyon({ _count: { tripLogLinks: 0, shares: 0 } }), true),
    ).toBe(false);
  });

  it("is false when _count is absent — never coalesce a missing tally to done", () => {
    expect(isCanyonDoneByViewer(canyon(), true)).toBe(false);
  });

  it("is false for a shared canyon even when the owner's tally is positive", () => {
    // Privacy/self-only boundary: the count is the owner's, not the viewer's.
    expect(
      isCanyonDoneByViewer(canyon({ _count: { tripLogLinks: 5, shares: 0 } }), false),
    ).toBe(false);
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

describe("passesFilters — area", () => {
  // A box around the canyon fixture at -33.5, 150.3.
  const around = { west: 150.2, south: -33.6, east: 150.4, north: -33.4 };

  it("keeps a canyon inside the box and drops one outside", () => {
    const f = filters({ area: around });
    expect(passesFilters(canyon(), f, true)).toBe(true);
    expect(
      passesFilters(canyon({ latitude: -34.2, longitude: 150.3 }), f, true),
    ).toBe(false);
    expect(
      passesFilters(canyon({ latitude: -33.5, longitude: 151.1 }), f, true),
    ).toBe(false);
  });

  it("is inclusive on every edge", () => {
    const f = filters({ area: around });
    for (const corner of [
      { latitude: around.north, longitude: around.west },
      { latitude: around.north, longitude: around.east },
      { latitude: around.south, longitude: around.west },
      { latitude: around.south, longitude: around.east },
    ]) {
      expect(passesFilters(canyon(corner), f, true)).toBe(true);
    }
  });

  it("does not treat a position outside the box as an unknown", () => {
    // include_unknowns rescues canyons with a MISSING value; a canyon that has
    // a position and sits outside the box is a known miss, not a gap.
    const f = filters({ area: around, include_unknowns: true });
    expect(
      passesFilters(canyon({ latitude: -34.2, longitude: 150.3 }), f, true),
    ).toBe(false);
  });

  it("counts as one active filter", () => {
    expect(activeFilterCount(filters({ area: around }))).toBe(1);
    expect(activeFilterCount(filters())).toBe(0);
    expect(hasActiveFilters(filters({ area: around }))).toBe(true);
  });

  it("is inactive when null", () => {
    expect(
      passesFilters(canyon({ latitude: -40, longitude: 120 }), filters(), true),
    ).toBe(true);
  });
});

describe("isCanyonInArea", () => {
  it("is the comparison passesFilters uses", () => {
    const area = { west: 150.2, south: -33.6, east: 150.4, north: -33.4 };
    expect(isCanyonInArea({ latitude: -33.5, longitude: 150.3 }, area)).toBe(true);
    expect(isCanyonInArea({ latitude: -33.5, longitude: 150.5 }, area)).toBe(false);
  });
});

describe("passesFilters — date range", () => {
  it("created_at start bound excludes earlier canyons", () => {
    const f = filters({ created_at: ["2026-02-01", null] });
    expect(passesFilters(canyon({ createdAt: "2026-03-01T00:00:00.000Z" }), f, true)).toBe(true);
    expect(passesFilters(canyon({ createdAt: "2026-01-01T00:00:00.000Z" }), f, true)).toBe(false);
  });

  it("created_at end bound is inclusive of the whole end day", () => {
    // Day bounds mean the VIEWER's day. These instants are built from local
    // wall-clock times so the assertion says the same thing in every zone —
    // written as fixed Z instants it silently asserted UTC days, which is the
    // bug (in Sydney, 18:30 UTC on the 16th is already the 17th).
    const localInstant = (wallClock: string) =>
      new Date(wallClock).toISOString();
    const f = filters({ created_at: [null, "2026-06-16"] });
    expect(
      passesFilters(canyon({ createdAt: localInstant("2026-06-16T18:30:00") }), f, true),
    ).toBe(true);
    expect(
      passesFilters(canyon({ createdAt: localInstant("2026-06-17T00:00:00") }), f, true),
    ).toBe(false);
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

// Two lists that must agree, with nothing in the type system making them: the
// fields of CanyonFilters, and the keys the badge counts. A filter added to the
// type but missed here hides canyons while the badge reads zero — so the
// "Clear filters" affordance never appears and the user is left with a list
// that is quietly short. This fails the moment a field joins one list and not
// the other, which is the only point at which anyone is looking.
describe("filter keys — counted and uncounted partition the type", () => {
  it("assigns every CanyonFilters field to exactly one list", () => {
    const declared = Object.keys(emptyFilters).sort();
    const accounted = [...COUNTED_FILTER_KEYS, ...UNCOUNTED_FILTER_KEYS].sort();
    expect(accounted).toEqual(declared);
  });

  it("lists no key twice", () => {
    const accounted = [...COUNTED_FILTER_KEYS, ...UNCOUNTED_FILTER_KEYS];
    expect(new Set(accounted).size).toBe(accounted.length);
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

describe("canyonMatchesSearch", () => {
  it("matches the primary name, case- and whitespace-insensitively", () => {
    expect(canyonMatchesSearch(canyon(), "  EMPRESS  ")).toBe(true);
    expect(canyonMatchesSearch(canyon(), "claustral")).toBe(false);
  });

  it("matches an alternative name", () => {
    const c = canyon({ name: "Bowens Creek North", altNames: ["Bowens North"] });
    expect(canyonMatchesSearch(c, "bowens north")).toBe(true);
  });

  it("an empty query matches everything", () => {
    expect(canyonMatchesSearch(canyon(), "   ")).toBe(true);
  });
});

describe("compareCanyons", () => {
  const sorted = (rows: TCanyon[], sort: Parameters<typeof compareCanyons>[2]) =>
    [...rows].sort((a, b) => compareCanyons(a, b, sort)).map((c) => c.name);

  it("sorts by name, then by newest first for recent", () => {
    const rows = [
      canyon({ name: "Zobra", createdAt: "2026-01-01T00:00:00.000Z" }),
      canyon({ name: "Alpha", createdAt: "2026-05-01T00:00:00.000Z" }),
    ];
    expect(sorted(rows, "name")).toEqual(["Alpha", "Zobra"]);
    expect(sorted(rows, "recent")).toEqual(["Alpha", "Zobra"]);
  });

  it("sorts grade easiest first, V before A", () => {
    const rows = [
      canyon({ name: "HardV", vGrade: 5, aGrade: 1 }),
      canyon({ name: "EasyV", vGrade: 3, aGrade: 4 }),
      canyon({ name: "SameVWetA", vGrade: 3, aGrade: 5 }),
    ];
    expect(sorted(rows, "grade")).toEqual(["EasyV", "SameVWetA", "HardV"]);
  });

  it("sorts quality best first and puts an unrated canyon last, not first", () => {
    const rows = [
      canyon({ name: "Unrated", quality: null }),
      canyon({ name: "Good", quality: 4 }),
      canyon({ name: "Best", quality: 5 }),
    ];
    expect(sorted(rows, "quality")).toEqual(["Best", "Good", "Unrated"]);
  });

  it("falls back to name so the order is total, not arbitrary", () => {
    const rows = [
      canyon({ name: "Beta", vGrade: 3, aGrade: 3 }),
      canyon({ name: "Alpha", vGrade: 3, aGrade: 3 }),
    ];
    expect(sorted(rows, "grade")).toEqual(["Alpha", "Beta"]);
  });
});

describe("passesFilters — date range timezone and validity", () => {
  it("files a canyon under the viewer's day, not UTC's", () => {
    // Added 09:00 on 15 January local. East of UTC that instant is still
    // 14 January in UTC, and the filter used to file it under the 14th: it
    // was excluded from "from the 15th" and included in "up to the 14th".
    const addedAt = new Date("2026-01-15T09:00:00").toISOString();
    expect(
      passesFilters(canyon({ createdAt: addedAt }), filters({ created_at: ["2026-01-15", null] }), true),
    ).toBe(true);
    expect(
      passesFilters(canyon({ createdAt: addedAt }), filters({ created_at: [null, "2026-01-14"] }), true),
    ).toBe(false);
  });

  it("an unparseable timestamp is unknown, not a universal match", () => {
    // Every `<`/`>` against NaN is false, so a value like "15/01/2026" used to
    // pass EVERY range — in or out of it.
    const range: [string, string] = ["2026-01-01", "2026-01-31"];
    const shown = filters({ created_at: range, include_unknowns: true });
    const hidden = filters({ created_at: range, include_unknowns: false });
    expect(passesFilters(canyon({ createdAt: "15/01/2026" }), shown, true)).toBe(true);
    expect(passesFilters(canyon({ createdAt: "15/01/2026" }), hidden, true)).toBe(false);
  });
});
