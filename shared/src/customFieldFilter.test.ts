import { describe, expect, it } from "vitest";

import {
  customFilterKind,
  passesCustomFieldFilters,
  passesDateRangeFilter,
  reconcileCustomFieldFilters,
  type CustomFieldFilter,
} from "./customFieldFilter.js";
import type { TripLogCustomFieldDef } from "./tripLogFields.js";

function def(overrides: Partial<TripLogCustomFieldDef> = {}): TripLogCustomFieldDef {
  return {
    key: "rope_length",
    label: "Rope length",
    type: "integer",
    min: null,
    max: null,
    ...overrides,
  } as TripLogCustomFieldDef;
}

const pass = (
  values: unknown,
  custom: Record<string, CustomFieldFilter>,
  includeUnknowns = false,
) => passesCustomFieldFilters(values, custom, includeUnknowns);

describe("customFilterKind", () => {
  it("gives a bounded number a range and an unbounded one an operator", () => {
    expect(customFilterKind(def({ min: 0, max: 5 }))).toBe("numberRange");
    expect(customFilterKind(def())).toBe("number");
  });

  it("maps the remaining types by their shape", () => {
    expect(customFilterKind(def({ type: "string" }))).toBe("text");
    expect(customFilterKind(def({ type: "date" }))).toBe("date");
    expect(customFilterKind(def({ type: "boolean" }))).toBe("boolean");
  });
});

describe("passesCustomFieldFilters", () => {
  it("passes a record with no filters at all", () => {
    expect(pass({}, {})).toBe(true);
    expect(passesCustomFieldFilters(null, undefined, false)).toBe(true);
  });

  // THE SAME OBJECT SHAPE SERVES BOTH ENTITIES: a place passes `fieldValues`
  // and a trip `customFields`, and the predicate cannot tell them apart. This
  // is the whole reason the rule was lifted out of `passesPlaceFilters`.
  it("reads a place's fieldValues and a trip's customFields identically", () => {
    const filter: Record<string, CustomFieldFilter> = {
      rope_length: { kind: "number", op: "More than", value: 30 },
    };
    expect(pass({ rope_length: 60 }, filter)).toBe(true);
    expect(pass({ rope_length: 20 }, filter)).toBe(false);
  });

  it("matches text case-insensitively as a contains", () => {
    const filter: Record<string, CustomFieldFilter> = {
      notes: { kind: "text", value: "WET" },
    };
    expect(pass({ notes: "very wet descent" }, filter)).toBe(true);
    expect(pass({ notes: "dry" }, filter)).toBe(false);
  });

  it("applies each numeric operator", () => {
    const of = (op: "Less than" | "More than" | "Exactly") => ({
      rope_length: { kind: "number" as const, op, value: 30 },
    });
    expect(pass({ rope_length: 29 }, of("Less than"))).toBe(true);
    expect(pass({ rope_length: 30 }, of("Less than"))).toBe(false);
    expect(pass({ rope_length: 31 }, of("More than"))).toBe(true);
    expect(pass({ rope_length: 30 }, of("More than"))).toBe(false);
    expect(pass({ rope_length: 30 }, of("Exactly"))).toBe(true);
  });

  it("treats a numberRange as inclusive of both bounds", () => {
    const filter: Record<string, CustomFieldFilter> = {
      v_grade: { kind: "numberRange", range: [3, 5] },
    };
    expect(pass({ v_grade: 3 }, filter)).toBe(true);
    expect(pass({ v_grade: 5 }, filter)).toBe(true);
    expect(pass({ v_grade: 6 }, filter)).toBe(false);
  });

  it("matches a boolean exactly, including false", () => {
    expect(pass({ wetsuit: false }, { wetsuit: { kind: "boolean", value: false } })).toBe(true);
    expect(pass({ wetsuit: true }, { wetsuit: { kind: "boolean", value: false } })).toBe(false);
  });

  // The regression the extracted module exists to keep fixed: a date that
  // cannot be placed on a calendar used to match EVERY range, in or out.
  it("treats an unparsable date as unknown rather than as a match", () => {
    const filter: Record<string, CustomFieldFilter> = {
      surveyed: { kind: "date", range: ["2026-01-01", "2026-12-31"] },
    };
    expect(pass({ surveyed: "15/01/2026" }, filter)).toBe(false);
    expect(pass({ surveyed: "15/01/2026" }, filter, true)).toBe(true);
    expect(pass({ surveyed: "2026-06-01" }, filter)).toBe(true);
  });

  describe("an unanswered field", () => {
    const filter: Record<string, CustomFieldFilter> = {
      rope_length: { kind: "number", op: "More than", value: 30 },
    };

    it("is dropped by default and kept when unknowns are included", () => {
      expect(pass({}, filter)).toBe(false);
      expect(pass({}, filter, true)).toBe(true);
    });

    // `fieldValue` maps null to undefined, so a field the user cleared reads
    // the same as one never filled in.
    it("counts a null the same as a missing key", () => {
      expect(pass({ rope_length: null }, filter)).toBe(false);
      expect(pass({ rope_length: null }, filter, true)).toBe(true);
    });

    it("is unknown for a range filter too when the value is not a number", () => {
      const range: Record<string, CustomFieldFilter> = {
        v_grade: { kind: "numberRange", range: [3, 5] },
      };
      expect(pass({ v_grade: "hard" }, range)).toBe(false);
      expect(pass({ v_grade: "hard" }, range, true)).toBe(true);
    });
  });
});

describe("passesDateRangeFilter", () => {
  it("passes when there is no filter or no bound", () => {
    expect(passesDateRangeFilter("2026-06-01", null, false)).toBe(true);
    expect(passesDateRangeFilter("2026-06-01", [null, null], false)).toBe(true);
  });

  it("is inclusive of a bound's whole day", () => {
    expect(passesDateRangeFilter("2026-01-15T09:00:00+11:00", ["2026-01-15", null], false)).toBe(true);
    expect(passesDateRangeFilter("2026-01-15T23:59:00+11:00", [null, "2026-01-15"], false)).toBe(true);
    expect(passesDateRangeFilter("2026-01-14T23:59:00+11:00", ["2026-01-15", null], false)).toBe(false);
  });

  it("defers a missing value to includeUnknowns", () => {
    expect(passesDateRangeFilter(null, ["2026-01-01", null], false)).toBe(false);
    expect(passesDateRangeFilter(null, ["2026-01-01", null], true)).toBe(true);
  });
});

describe("reconcileCustomFieldFilters", () => {
  const filters: Record<string, CustomFieldFilter> = {
    rope_length: { kind: "number", op: "More than", value: 30 },
  };

  it("keeps a filter whose definition still produces its kind", () => {
    expect(reconcileCustomFieldFilters(filters, [def()])).toBe(filters);
  });

  it("drops a filter whose field is gone", () => {
    expect(reconcileCustomFieldFilters(filters, [])).toEqual({});
  });

  it("drops a filter whose field changed type under it", () => {
    expect(reconcileCustomFieldFilters(filters, [def({ min: 0, max: 5 })])).toEqual({});
    expect(reconcileCustomFieldFilters(filters, [def({ type: "string" })])).toEqual({});
  });
});
