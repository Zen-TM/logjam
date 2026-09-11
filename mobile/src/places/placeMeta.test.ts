import { describe, expect, it } from "vitest";

import { placeStatus, placeSummary, qualityLabel } from "./placeMeta";

describe("placeStatus", () => {
  it("is done for an owned place with at least one of the viewer's trips", () => {
    expect(placeStatus({ syncRole: "owner" }, 1)).toBe("done");
    expect(placeStatus({ syncRole: "owner" }, 0)).toBe("todo");
  });

  it("is shared for a shared place whatever the count says", () => {
    // The count can only ever be 0 here, but the rule must not depend on that:
    // reading a stray tally as "done" would claim the viewer ran a friend's place.
    expect(placeStatus({ syncRole: "shared" }, 0)).toBe("shared");
    expect(placeStatus({ syncRole: "shared" }, 3)).toBe("shared");
  });
});

/** A summary fixture. The seven grades are field VALUES now, so the helper
 *  takes the same names the tests used and writes them under the reserved
 *  keys — which is exactly what the form does. */
function summaryOf(fields: {
  vGrade?: number;
  aGrade?: number;
  commitment?: number;
  hours?: number;
  longestAbseil?: number;
  numAbseils?: number;
}): string {
  return placeSummary({
    fieldValues: {
      ...(fields.vGrade != null ? { v_grade: fields.vGrade } : {}),
      ...(fields.aGrade != null ? { a_grade: fields.aGrade } : {}),
      ...(fields.commitment != null ? { commitment: fields.commitment } : {}),
      ...(fields.hours != null ? { hours: fields.hours } : {}),
      ...(fields.longestAbseil != null
        ? { longest_abseil: fields.longestAbseil }
        : {}),
      ...(fields.numAbseils != null ? { num_abseils: fields.numAbseils } : {}),
    },
  });
}

describe("placeSummary", () => {
  it("leads with the grade, then time and rope length", () => {
    expect(
      summaryOf({
        vGrade: 4,
        aGrade: 3,
        commitment: 3,
        hours: 6,
        longestAbseil: 30,
        numAbseils: 8,
      }),
    ).toBe("v4a3 III · 6 h · 30 m max");
  });

  it("caps at three facts, but promotes a lower-priority one when a gap frees a slot", () => {
    // Nothing ellipsises mid-number in a row this narrow, and an abseil count is
    // worth more than the fourth slot it would otherwise sit in.
    expect(summaryOf({
        vGrade: 1, aGrade: 2, hours: 7, numAbseils: 0 })).toBe(
      "v1a2 · 7 h · 0 abseils",
    );
  });

  it("states only what is known, with no placeholders", () => {
    expect(summaryOf({
        vGrade: 3 })).toBe("v3");
    expect(summaryOf({})).toBe("");
  });

  it("trims a whole float but keeps a real fraction", () => {
    expect(summaryOf({
        hours: 4 })).toBe("4 h");
    expect(summaryOf({
        hours: 4.5 })).toBe("4.5 h");
  });
});

describe("qualityLabel", () => {
  it("is null when unrated, because absent is not zero stars", () => {
    expect(qualityLabel(null)).toBeNull();
    expect(qualityLabel(undefined)).toBeNull();
    expect(qualityLabel(0)).toBe("★ 0");
    expect(qualityLabel(4)).toBe("★ 4");
  });
});
