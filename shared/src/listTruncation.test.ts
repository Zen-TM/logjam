import { describe, expect, it } from "vitest";

import { friendSearchHint, truncationHint } from "./listTruncation";

describe("truncationHint", () => {
  it("says nothing when nothing was cut", () => {
    expect(truncationHint(12, 0)).toBeNull();
  });

  it("reports the shown and the true total", () => {
    expect(truncationHint(40, 7)).toBe(
      "Showing 40 of 47 — keep typing to narrow it down.",
    );
  });
});

// Mutation that turns the first two red: compare `shown >= cap` before looking
// at `total`, so a full page with an exact total of 10 says it was cut.
describe("friendSearchHint", () => {
  it("trusts the server total over a full page", () => {
    expect(friendSearchHint(10, 10)).toBeNull();
    expect(friendSearchHint(10, 23)).toBe(
      "Showing 10 of 23 — keep typing to narrow it down.",
    );
  });

  it("says nothing for a short page", () => {
    expect(friendSearchHint(3, 3)).toBeNull();
    expect(friendSearchHint(3, null)).toBeNull();
  });

  it("falls back to a full page when the API sent no total", () => {
    expect(friendSearchHint(10, null)).toBe(
      "Showing the first 10 — keep typing to narrow it down.",
    );
  });
});

// A page of results with some drawn elsewhere (a plan's friends, listed above
// the search results). Mutation that turns it red: pass `results.length`
// instead of the rows drawn and leave `omitted` out of the sum, and the hint
// counts rows that are not under it.
describe("friendSearchHint, with results drawn elsewhere", () => {
  it("counts only the rows under it", () => {
    // 10 came back of 12 matches; 3 of the 10 are friends, listed above.
    expect(friendSearchHint(7, 12, 3)).toBe(
      "Showing 7 of 9 — keep typing to narrow it down.",
    );
    expect(friendSearchHint(7, 10, 3)).toBeNull();
  });

  it("says nothing when every result is drawn elsewhere", () => {
    expect(friendSearchHint(0, 23, 10)).toBeNull();
    expect(friendSearchHint(0, null, 10)).toBeNull();
  });

  it("still reads a full page when the API sent no total", () => {
    expect(friendSearchHint(7, null, 3)).toBe(
      "Showing the first 7 — keep typing to narrow it down.",
    );
  });
});
