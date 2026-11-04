import { describe, expect, it } from "vitest";

import { attachSummary } from "./attachSummary.js";

// Both clients draw this sentence (Logjam GPS after a pick, Logjam Web after an
// upload), so these strings are the parity.
describe("attachSummary", () => {
  // Mutation: drop the plural `s` in whatWasAdded() and "3 photos" becomes
  // "3 photo".
  it("reads as one action when everything went in", () => {
    expect(attachSummary(["image", "image", "image"], 0)).toEqual({
      message: "3 photos added.",
      tone: "done",
    });
    expect(attachSummary(["image"], 0)?.message).toBe("1 photo added.");
    expect(attachSummary(["video", "video"], 0)?.message).toBe(
      "2 videos added.",
    );
  });

  // Mutation: revert the mixed case to a generic "items" and this fails (and
  // copyRules.test.ts bans the word).
  it("names each kind in a mixed pick", () => {
    expect(attachSummary(["image", "image", "video"], 0)?.message).toBe(
      "2 photos and 1 video added.",
    );
  });

  // Mutation: report only `added` (or only `failed`) and the "2 of 3" or the
  // "1 couldn't be added" half disappears.
  it("says how many went in and how many did not", () => {
    expect(attachSummary(["image", "image"], 1)).toEqual({
      message: "2 of 3 added. 1 couldn't be added.",
      tone: "error",
    });
  });

  it("names a total failure, single or many", () => {
    expect(attachSummary([], 1)?.message).toBe(
      "That file couldn't be attached.",
    );
    expect(attachSummary([], 3)?.message).toBe("Couldn't add any of the 3.");
  });

  it("stays silent when nothing was picked", () => {
    expect(attachSummary([], 0)).toBeNull();
  });
});
