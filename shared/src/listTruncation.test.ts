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
