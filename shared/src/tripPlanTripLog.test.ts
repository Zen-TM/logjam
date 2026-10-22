import { describe, expect, it, vi } from "vitest";

import { saveTripPlanPlaces } from "./tripPlanTripLog.js";

describe("saveTripPlanPlaces", () => {
  // Mutations: save every pick again on a retry (a second copy of "a" in
  // the user's places); or count only this run's copies in the stop (it
  // says nothing of "a", already saved).
  it("saves only what a stopped run didn't, in order, and says what landed", async () => {
    const offline = new Error("offline");
    const save = vi
      .fn()
      .mockResolvedValueOnce({ id: "copy-b", mediaSkipped: 2 })
      .mockRejectedValueOnce(offline);
    const run = await saveTripPlanPlaces({
      picked: [{ id: "a" }, { id: "b" }, { id: "c" }],
      copies: { a: "copy-a" },
      save,
      why: () => "No connection.",
    });
    expect(save.mock.calls).toEqual([["b"], ["c"]]);
    expect(run).toEqual({
      copies: { a: "copy-a", b: "copy-b" },
      added: 1,
      skipped: 2,
      outOfSpace: false,
      stopped: {
        message: "2 copies saved to your places. No connection.",
        error: offline,
        refetch: false,
      },
    });
  });
});
