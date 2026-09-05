import { describe, it, expect } from "vitest";
import { formatCanyonGrade } from "./placeUtils";

// `formatCanyonGrade` takes the FIELD VALUES now rather than a place-shaped
// object: the three grades are reserved keys in `fieldValues`, not columns.
// It stays canyon-specific on purpose — `v3a4 III` is how a canyon's grade is
// written and no other place type has one, so this is a presenter the generic
// field renderer defers to, not a rule applied to everything.
function grades(
  overrides: { vGrade?: number; aGrade?: number; commitment?: number } = {},
): Record<string, unknown> {
  return {
    ...(overrides.vGrade != null ? { v_grade: overrides.vGrade } : {}),
    ...(overrides.aGrade != null ? { a_grade: overrides.aGrade } : {}),
    ...(overrides.commitment != null ? { commitment: overrides.commitment } : {}),
  };
}

describe("formatCanyonGrade — fully specified", () => {
  it("joins v, a and commitment", () => {
    expect(formatCanyonGrade(grades({ vGrade: 3, aGrade: 4, commitment: 3 }))).toBe(
      "v3a4 III",
    );
  });

  it("renders v and a glued together with no commitment", () => {
    expect(formatCanyonGrade(grades({ vGrade: 2, aGrade: 1 }))).toBe("v2a1");
  });
});

describe("formatCanyonGrade — omits unset segments instead of '?'", () => {
  // The regression this file exists for: a place with no A grade rendered
  // "v2a?", which reads as corrupt data rather than "not recorded".
  it("omits a missing A grade rather than substituting '?'", () => {
    expect(formatCanyonGrade(grades({ vGrade: 2 }))).toBe("v2");
  });

  it("omits a missing V grade rather than substituting '?'", () => {
    expect(formatCanyonGrade(grades({ aGrade: 3 }))).toBe("a3");
  });

  it("renders commitment alone with no leading placeholder or space", () => {
    expect(formatCanyonGrade(grades({ commitment: 2 }))).toBe("II");
  });

  it("emits no '?' for any single-value combination", () => {
    for (const c of [
      grades({ vGrade: 1 }),
      grades({ aGrade: 1 }),
      grades({ commitment: 1 }),
      grades({ vGrade: 1, commitment: 1 }),
      grades({ aGrade: 1, commitment: 1 }),
    ]) {
      expect(formatCanyonGrade(c)).not.toContain("?");
    }
  });

  it("never leaves a stray leading or trailing space", () => {
    for (const c of [
      grades({ vGrade: 4 }),
      grades({ aGrade: 4 }),
      grades({ commitment: 4 }),
      grades({ vGrade: 4, commitment: 4 }),
    ]) {
      const grade = formatCanyonGrade(c);
      expect(grade).toBe(grade?.trim());
    }
  });
});

describe("formatCanyonGrade — nothing set", () => {
  it("returns null so the caller can drop the 'Grade:' label entirely", () => {
    expect(formatCanyonGrade(grades())).toBeNull();
  });
});

describe("formatCanyonGrade — defensive", () => {
  it("never renders 'undefined' for an out-of-range commitment", () => {
    // Commitment is validated to 1-6 upstream; if that ever slips, the display
    // must degrade to omitting the numeral, not printing "undefined".
    const grade = formatCanyonGrade(grades({ vGrade: 2, commitment: 99 }));
    expect(grade).not.toContain("undefined");
    expect(grade).toBe("v2");
  });
});
