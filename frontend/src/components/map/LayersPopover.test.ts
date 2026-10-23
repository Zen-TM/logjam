import { describe, expect, it } from "vitest";

import type { CompletedTopoJob } from "../../topoLayerTypes";
import { jobsWithOverlays } from "./LayersPopover";

describe("jobsWithOverlays", () => {
  // Mutation: list every job, and a sharpened job with no vegetation gets a
  // switch that turns nothing on or off.
  it("leaves out a job with no overlay layer", () => {
    const legacy = { jobId: "l", layers: [{ name: "hillshade" }] };
    const sharpened = { jobId: "s", layers: [], sharpened: {} };
    const withVegetation = {
      jobId: "v",
      layers: [{ name: "vegetation" }],
      sharpened: {},
    };
    expect(
      jobsWithOverlays([
        legacy,
        sharpened,
        withVegetation,
      ] as unknown as CompletedTopoJob[]).map((job) => job.jobId),
    ).toEqual(["l", "v"]);
  });
});
