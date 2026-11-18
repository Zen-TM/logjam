import { describe, expect, it } from "vitest";
import {
  autoImportedLine,
  importSummary,
  reviewAppliedToast,
} from "./ropeWikiCounts";

// Mutation that turns it red: swapping two counts in one message, or dropping
// the case where only the middle count is above zero.
describe("ropeWikiCounts", () => {
  it("names only the counts above zero, in order", () => {
    expect(importSummary(3, 2, 1)).toBe(
      "RopeWiki import: 3 added, 2 linked, 1 updated",
    );
    expect(importSummary(3, 0, 1)).toBe("RopeWiki import: 3 added, 1 updated");
    expect(importSummary(0, 2, 0)).toBe("RopeWiki import: 2 linked");
    expect(importSummary(0, 0, 0)).toBe("RopeWiki import: no new places");
  });

  it("ends the auto-import note and the review toast with a full stop", () => {
    expect(autoImportedLine(1, 2, 0)).toBe(
      "Already imported automatically: 1 added, 2 linked to existing.",
    );
    expect(autoImportedLine(0, 0, 0)).toBe("");
    expect(reviewAppliedToast(1, 0, 4)).toBe(
      "Review applied: 1 created, 4 skipped.",
    );
    expect(reviewAppliedToast(0, 0, 0)).toBe("Review applied.");
  });

  it("covers every combination of the three counts", () => {
    const seen = new Set<string>();
    for (let m = 0; m < 8; m++) {
      const [a, b, c] = [m & 4 ? 5 : 0, m & 2 ? 6 : 0, m & 1 ? 7 : 0];
      seen.add(reviewAppliedToast(a, b, c));
      expect(reviewAppliedToast(a, b, c)).toContain(a ? "5 created" : "Review");
    }
    expect(seen.size).toBe(8);
  });
});
