import { describe, it, expect } from "vitest";
import { formatCanyonGrade } from "./placeUtils";
import type { TPlace } from "./placeUtils";

function place(overrides: Partial<TPlace> = {}): TPlace {
  return {
    id: "c1",
    name: "Claustral Canyon",
    latitude: -33.5,
    longitude: 150.3,
    altNames: [],
    vGrade: null,
    aGrade: null,
    commitment: null,
    quality: null,
    numAbseils: null,
    longestAbseil: null,
    hours: null,
    notes: null,
    attributes: {},
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  } as unknown as TPlace;
}

describe("formatCanyonGrade — fully specified", () => {
  it("joins v, a and commitment", () => {
    expect(formatCanyonGrade(place({ vGrade: 3, aGrade: 4, commitment: 3 }))).toBe(
      "v3a4 III",
    );
  });

  it("renders v and a glued together with no commitment", () => {
    expect(formatCanyonGrade(place({ vGrade: 2, aGrade: 1 }))).toBe("v2a1");
  });
});

describe("formatCanyonGrade — omits unset segments instead of '?'", () => {
  // The regression this file exists for: a place with no A grade rendered
  // "v2a?", which reads as corrupt data rather than "not recorded".
  it("omits a missing A grade rather than substituting '?'", () => {
    expect(formatCanyonGrade(place({ vGrade: 2 }))).toBe("v2");
  });

  it("omits a missing V grade rather than substituting '?'", () => {
    expect(formatCanyonGrade(place({ aGrade: 3 }))).toBe("a3");
  });

  it("renders commitment alone with no leading placeholder or space", () => {
    expect(formatCanyonGrade(place({ commitment: 2 }))).toBe("II");
  });

  it("emits no '?' for any single-value combination", () => {
    for (const c of [
      place({ vGrade: 1 }),
      place({ aGrade: 1 }),
      place({ commitment: 1 }),
      place({ vGrade: 1, commitment: 1 }),
      place({ aGrade: 1, commitment: 1 }),
    ]) {
      expect(formatCanyonGrade(c)).not.toContain("?");
    }
  });

  it("never leaves a stray leading or trailing space", () => {
    for (const c of [
      place({ vGrade: 4 }),
      place({ aGrade: 4 }),
      place({ commitment: 4 }),
      place({ vGrade: 4, commitment: 4 }),
    ]) {
      const grade = formatCanyonGrade(c);
      expect(grade).toBe(grade?.trim());
    }
  });
});

describe("formatCanyonGrade — nothing set", () => {
  it("returns null so the caller can drop the 'Grade:' label entirely", () => {
    expect(formatCanyonGrade(place())).toBeNull();
  });
});

describe("formatCanyonGrade — defensive", () => {
  it("never renders 'undefined' for an out-of-range commitment", () => {
    // Commitment is validated to 1-6 upstream; if that ever slips, the display
    // must degrade to omitting the numeral, not printing "undefined".
    const grade = formatCanyonGrade(place({ vGrade: 2, commitment: 99 }));
    expect(grade).not.toContain("undefined");
    expect(grade).toBe("v2");
  });
});
