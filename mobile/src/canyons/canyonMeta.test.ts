import { describe, expect, it } from "vitest";

import { canyonStatus, canyonSummary, qualityLabel } from "./canyonMeta";

const blank = {
  vGrade: null,
  aGrade: null,
  commitment: null,
  numAbseils: null,
  longestAbseil: null,
  hours: null,
};

describe("canyonStatus", () => {
  it("is done for an owned canyon with at least one of the viewer's trips", () => {
    expect(canyonStatus({ syncRole: "owner" }, 1)).toBe("done");
    expect(canyonStatus({ syncRole: "owner" }, 0)).toBe("todo");
  });

  it("is shared for a shared canyon whatever the count says", () => {
    // The count can only ever be 0 here, but the rule must not depend on that:
    // reading a stray tally as "done" would claim the viewer ran a friend's canyon.
    expect(canyonStatus({ syncRole: "shared" }, 0)).toBe("shared");
    expect(canyonStatus({ syncRole: "shared" }, 3)).toBe("shared");
  });
});

describe("canyonSummary", () => {
  it("leads with the grade, then time and rope length", () => {
    expect(
      canyonSummary({
        ...blank,
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
    expect(canyonSummary({ ...blank, vGrade: 1, aGrade: 2, hours: 7, numAbseils: 0 })).toBe(
      "v1a2 · 7 h · 0 abseils",
    );
  });

  it("states only what is known, with no placeholders", () => {
    expect(canyonSummary({ ...blank, vGrade: 3 })).toBe("v3");
    expect(canyonSummary(blank)).toBe("");
  });

  it("trims a whole float but keeps a real fraction", () => {
    expect(canyonSummary({ ...blank, hours: 4 })).toBe("4 h");
    expect(canyonSummary({ ...blank, hours: 4.5 })).toBe("4.5 h");
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
