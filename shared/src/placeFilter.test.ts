import { describe, it, expect } from "vitest";

import {
  activePlaceFilterCount as activeFilterCount,
  COUNTED_FILTER_KEYS,
  UNCOUNTED_FILTER_KEYS,
  placeMatchesSearch,
  comparePlaces,
  EMPTY_PLACE_FILTERS as emptyFilters,
  hasActivePlaceFilters as hasActiveFilters,
  isPlaceDoneByViewer,
  isPlaceInArea,
  passesPlaceFilters as passesFilters,
  reconcileCustomFilters,
} from "./placeFilter.js";
import type { PlaceFilterFields, PlaceFilters as TFilters } from "./placeFilter.js";
import type { TripLogCustomFieldDef } from "./tripLogFields.js";

// Named TPlace here because these cases were written against the web place
// type; the predicate only ever reads the structural subset.
type TPlace = PlaceFilterFields & { id: string; latitude: number; longitude: number };

// Override type permits null on any field so tests can simulate places with
// missing values (the API types them non-null, but filters must handle gaps).
function place(
  overrides: Partial<{ [K in keyof TPlace]: TPlace[K] | null }> = {},
): TPlace {
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
  } as unknown as TPlace;
}

function filters(overrides: Partial<TFilters> = {}): TFilters {
  return { ...emptyFilters, ...overrides };
}

describe("passesFilters — ownership", () => {
  it("owned-only keeps owned, drops shared", () => {
    const f = filters({ ownership: "owned" });
    expect(passesFilters(place(), f, true)).toBe(true);
    expect(passesFilters(place(), f, false)).toBe(false);
  });

  it("shared-only keeps shared, drops owned", () => {
    const f = filters({ ownership: "shared" });
    expect(passesFilters(place(), f, false)).toBe(true);
    expect(passesFilters(place(), f, true)).toBe(false);
  });

  it("all keeps both buckets", () => {
    const f = filters({ ownership: "all" });
    expect(passesFilters(place(), f, true)).toBe(true);
    expect(passesFilters(place(), f, false)).toBe(true);
  });
});

describe("passesFilters — shared by me", () => {
  it("keeps places with at least one share, drops the rest", () => {
    const f = filters({ shared_by_me: true });
    expect(passesFilters(place({ _count: { tripLogLinks: 0, shares: 2 } }), f, true)).toBe(true);
    expect(passesFilters(place({ _count: { tripLogLinks: 0, shares: 0 } }), f, true)).toBe(false);
    expect(passesFilters(place(), f, true)).toBe(false); // _count absent
  });

  it("is inactive by default (keeps everything)", () => {
    const f = filters();
    expect(passesFilters(place(), f, true)).toBe(true);
    expect(hasActiveFilters(f)).toBe(false);
  });

  it("counts as an active filter when on", () => {
    expect(activeFilterCount(filters({ shared_by_me: true }))).toBe(1);
  });
});

describe("passesFilters — completion", () => {
  const done = place({ _count: { tripLogLinks: 3, shares: 0 } });
  const notDone = place({ _count: { tripLogLinks: 0, shares: 0 } });

  it("done keeps owned places with at least one linked trip", () => {
    const f = filters({ completion: "done" });
    expect(passesFilters(done, f, true)).toBe(true);
    expect(passesFilters(notDone, f, true)).toBe(false);
  });

  it("not_done keeps owned places with no linked trips", () => {
    const f = filters({ completion: "not_done" });
    expect(passesFilters(notDone, f, true)).toBe(true);
    expect(passesFilters(done, f, true)).toBe(false);
  });

  it("treats a place with one trip as done (boundary)", () => {
    const one = place({ _count: { tripLogLinks: 1, shares: 0 } });
    expect(passesFilters(one, filters({ completion: "done" }), true)).toBe(true);
    expect(passesFilters(one, filters({ completion: "not_done" }), true)).toBe(
      false,
    );
  });

  // A trip can only link to its own owner's places (the API enforces
  // ownerId in resolveTripPlaceIds), so tripLogLinks on a place shared WITH
  // the viewer counts the OWNER's trips. The viewer has never done it.
  it("never marks a shared place done, whatever the owner's count says", () => {
    expect(passesFilters(done, filters({ completion: "done" }), false)).toBe(
      false,
    );
    expect(passesFilters(done, filters({ completion: "not_done" }), false)).toBe(
      true,
    );
  });

  it("treats an absent _count as not done", () => {
    expect(passesFilters(place(), filters({ completion: "done" }), true)).toBe(
      false,
    );
    expect(
      passesFilters(place(), filters({ completion: "not_done" }), true),
    ).toBe(true);
  });

  it("ignores include_unknowns — zero trips is an answer, not a gap", () => {
    const f = filters({ completion: "done", include_unknowns: true });
    expect(passesFilters(notDone, f, true)).toBe(false);
    expect(passesFilters(place(), f, true)).toBe(false);
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
    expect(passesFilters(place({ vGrade: 2, _count: { tripLogLinks: 0, shares: 0 } }), f, true)).toBe(true);
    // right grade, but already done
    expect(passesFilters(place({ vGrade: 2, _count: { tripLogLinks: 1, shares: 0 } }), f, true)).toBe(false);
    // not done, but out of grade range
    expect(passesFilters(place({ vGrade: 6, _count: { tripLogLinks: 0, shares: 0 } }), f, true)).toBe(false);
  });
});

// Single source for the completion filter AND the map's completed-marker style.
describe("isPlaceDoneByViewer", () => {
  it("is true for an owned place with at least one logged trip", () => {
    expect(
      isPlaceDoneByViewer(place({ _count: { tripLogLinks: 3, shares: 0 } }), true),
    ).toBe(true);
  });

  it("is false for an owned place with zero trips", () => {
    expect(
      isPlaceDoneByViewer(place({ _count: { tripLogLinks: 0, shares: 0 } }), true),
    ).toBe(false);
  });

  it("is false when _count is absent — never coalesce a missing tally to done", () => {
    expect(isPlaceDoneByViewer(place(), true)).toBe(false);
  });

  it("is false for a shared place even when the owner's tally is positive", () => {
    // Privacy/self-only boundary: the count is the owner's, not the viewer's.
    expect(
      isPlaceDoneByViewer(place({ _count: { tripLogLinks: 5, shares: 0 } }), false),
    ).toBe(false);
  });
});

describe("passesFilters — ropewiki link", () => {
  it("linked keeps only places with a ropeWikiId", () => {
    const f = filters({ ropewiki: "linked" });
    expect(passesFilters(place({ ropeWikiId: 42 }), f, true)).toBe(true);
    expect(passesFilters(place({ ropeWikiId: null }), f, true)).toBe(false);
  });

  it("unlinked keeps only places without a ropeWikiId", () => {
    const f = filters({ ropewiki: "unlinked" });
    expect(passesFilters(place({ ropeWikiId: null }), f, true)).toBe(true);
    expect(passesFilters(place({ ropeWikiId: 42 }), f, true)).toBe(false);
  });
});

describe("passesFilters — area", () => {
  // A box around the place fixture at -33.5, 150.3.
  const around = { west: 150.2, south: -33.6, east: 150.4, north: -33.4 };

  it("keeps a place inside the box and drops one outside", () => {
    const f = filters({ area: around });
    expect(passesFilters(place(), f, true)).toBe(true);
    expect(
      passesFilters(place({ latitude: -34.2, longitude: 150.3 }), f, true),
    ).toBe(false);
    expect(
      passesFilters(place({ latitude: -33.5, longitude: 151.1 }), f, true),
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
      expect(passesFilters(place(corner), f, true)).toBe(true);
    }
  });

  it("does not treat a position outside the box as an unknown", () => {
    // include_unknowns rescues places with a MISSING value; a place that has
    // a position and sits outside the box is a known miss, not a gap.
    const f = filters({ area: around, include_unknowns: true });
    expect(
      passesFilters(place({ latitude: -34.2, longitude: 150.3 }), f, true),
    ).toBe(false);
  });

  it("counts as one active filter", () => {
    expect(activeFilterCount(filters({ area: around }))).toBe(1);
    expect(activeFilterCount(filters())).toBe(0);
    expect(hasActiveFilters(filters({ area: around }))).toBe(true);
  });

  it("is inactive when null", () => {
    expect(
      passesFilters(place({ latitude: -40, longitude: 120 }), filters(), true),
    ).toBe(true);
  });
});

describe("isPlaceInArea", () => {
  it("is the comparison passesFilters uses", () => {
    const area = { west: 150.2, south: -33.6, east: 150.4, north: -33.4 };
    expect(isPlaceInArea({ latitude: -33.5, longitude: 150.3 }, area)).toBe(true);
    expect(isPlaceInArea({ latitude: -33.5, longitude: 150.5 }, area)).toBe(false);
  });
});

describe("passesFilters — date range", () => {
  it("created_at start bound excludes earlier places", () => {
    const f = filters({ created_at: ["2026-02-01", null] });
    expect(passesFilters(place({ createdAt: "2026-03-01T00:00:00.000Z" }), f, true)).toBe(true);
    expect(passesFilters(place({ createdAt: "2026-01-01T00:00:00.000Z" }), f, true)).toBe(false);
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
      passesFilters(place({ createdAt: localInstant("2026-06-16T18:30:00") }), f, true),
    ).toBe(true);
    expect(
      passesFilters(place({ createdAt: localInstant("2026-06-17T00:00:00") }), f, true),
    ).toBe(false);
  });

  it("updated_at range filters on the updated timestamp", () => {
    const f = filters({ updated_at: ["2026-05-01", "2026-05-31"] });
    expect(passesFilters(place({ updatedAt: "2026-05-15T00:00:00.000Z" }), f, true)).toBe(true);
    expect(passesFilters(place({ updatedAt: "2026-06-01T00:00:00.000Z" }), f, true)).toBe(false);
  });

  it("a null-bounded range is treated as inactive", () => {
    const f = filters({ created_at: [null, null] });
    expect(passesFilters(place(), f, true)).toBe(true);
  });
});

describe("passesFilters — include_unknowns over new fields", () => {
  it("hides places with unknown dates when an active date filter excludes unknowns", () => {
    const f = filters({ created_at: ["2026-02-01", null], include_unknowns: false });
    expect(passesFilters(place({ createdAt: null }), f, true)).toBe(false);
  });

  it("keeps places with unknown dates when include_unknowns is on", () => {
    const f = filters({ created_at: ["2026-02-01", null], include_unknowns: true });
    expect(passesFilters(place({ createdAt: null }), f, true)).toBe(true);
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
// fields of PlaceFilters, and the keys the badge counts. A filter added to the
// type but missed here hides places while the badge reads zero — so the
// "Clear filters" affordance never appears and the user is left with a list
// that is quietly short. This fails the moment a field joins one list and not
// the other, which is the only point at which anyone is looking.
describe("filter keys — counted and uncounted partition the type", () => {
  it("assigns every PlaceFilters field to exactly one list", () => {
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
  function withCustom(customFields: Record<string, unknown>): TPlace {
    return place({ attributes: { customFields } });
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

  it("hides places missing a custom value unless include_unknowns is on", () => {
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

describe("placeMatchesSearch", () => {
  it("matches the primary name, case- and whitespace-insensitively", () => {
    expect(placeMatchesSearch(place(), "  EMPRESS  ")).toBe(true);
    expect(placeMatchesSearch(place(), "claustral")).toBe(false);
  });

  it("matches an alternative name", () => {
    const c = place({ name: "Bowens Creek North", altNames: ["Bowens North"] });
    expect(placeMatchesSearch(c, "bowens north")).toBe(true);
  });

  it("an empty query matches everything", () => {
    expect(placeMatchesSearch(place(), "   ")).toBe(true);
  });
});

describe("comparePlaces", () => {
  const sorted = (rows: TPlace[], sort: Parameters<typeof comparePlaces>[2]) =>
    [...rows].sort((a, b) => comparePlaces(a, b, sort)).map((c) => c.name);

  it("sorts by name, then by newest first for recent", () => {
    const rows = [
      place({ name: "Zobra", createdAt: "2026-01-01T00:00:00.000Z" }),
      place({ name: "Alpha", createdAt: "2026-05-01T00:00:00.000Z" }),
    ];
    expect(sorted(rows, "name")).toEqual(["Alpha", "Zobra"]);
    expect(sorted(rows, "recent")).toEqual(["Alpha", "Zobra"]);
  });

  it("sorts grade easiest first, V before A", () => {
    const rows = [
      place({ name: "HardV", vGrade: 5, aGrade: 1 }),
      place({ name: "EasyV", vGrade: 3, aGrade: 4 }),
      place({ name: "SameVWetA", vGrade: 3, aGrade: 5 }),
    ];
    expect(sorted(rows, "grade")).toEqual(["EasyV", "SameVWetA", "HardV"]);
  });

  it("sorts quality best first and puts an unrated place last, not first", () => {
    const rows = [
      place({ name: "Unrated", quality: null }),
      place({ name: "Good", quality: 4 }),
      place({ name: "Best", quality: 5 }),
    ];
    expect(sorted(rows, "quality")).toEqual(["Best", "Good", "Unrated"]);
  });

  it("falls back to name so the order is total, not arbitrary", () => {
    const rows = [
      place({ name: "Beta", vGrade: 3, aGrade: 3 }),
      place({ name: "Alpha", vGrade: 3, aGrade: 3 }),
    ];
    expect(sorted(rows, "grade")).toEqual(["Alpha", "Beta"]);
  });
});

describe("passesFilters — date range timezone and validity", () => {
  it("files a place under the viewer's day, not UTC's", () => {
    // Added 09:00 on 15 January local. East of UTC that instant is still
    // 14 January in UTC, and the filter used to file it under the 14th: it
    // was excluded from "from the 15th" and included in "up to the 14th".
    const addedAt = new Date("2026-01-15T09:00:00").toISOString();
    expect(
      passesFilters(place({ createdAt: addedAt }), filters({ created_at: ["2026-01-15", null] }), true),
    ).toBe(true);
    expect(
      passesFilters(place({ createdAt: addedAt }), filters({ created_at: [null, "2026-01-14"] }), true),
    ).toBe(false);
  });

  it("an unparseable timestamp is unknown, not a universal match", () => {
    // Every `<`/`>` against NaN is false, so a value like "15/01/2026" used to
    // pass EVERY range — in or out of it.
    const range: [string, string] = ["2026-01-01", "2026-01-31"];
    const shown = filters({ created_at: range, include_unknowns: true });
    const hidden = filters({ created_at: range, include_unknowns: false });
    expect(passesFilters(place({ createdAt: "15/01/2026" }), shown, true)).toBe(true);
    expect(passesFilters(place({ createdAt: "15/01/2026" }), hidden, true)).toBe(false);
  });
});
