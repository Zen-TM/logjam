import { describe, expect, it } from "vitest";

import type { CompletedTopoJob } from "../../topoLayerTypes";
import { jobsWithOverlays, lidarOverlayEmptyLine } from "./lidarOverlays";

const legacy = { jobId: "l", layers: [{ name: "hillshade" }] };
const sharpened = { jobId: "s", layers: [], sharpened: {} };
const withVegetation = {
  jobId: "v",
  layers: [{ name: "vegetation" }],
  sharpened: {},
};
const jobs = (...list: object[]) => list as unknown as CompletedTopoJob[];

describe("jobsWithOverlays", () => {
  // Mutation: list every job, and a sharpened job with no vegetation gets a
  // switch that turns nothing on or off.
  it("leaves out a job with no overlay layer", () => {
    expect(
      jobsWithOverlays(jobs(legacy, sharpened, withVegetation)).map(
        (job) => job.jobId,
      ),
    ).toEqual(["l", "v"]);
  });
});

describe("lidarOverlayEmptyLine", () => {
  // Mutation: "None yet" whenever no job has an overlay, and a user whose
  // areas are all sharpened is told to make one, which again shows nothing
  // here.
  it("says none yet only when there are no jobs", () => {
    expect(lidarOverlayEmptyLine(jobs())).toMatch(/^None yet/);
    expect(lidarOverlayEmptyLine(jobs(sharpened))).toMatch(/Terrain group/);
    expect(lidarOverlayEmptyLine(jobs(sharpened, legacy))).toBeNull();
  });
});
