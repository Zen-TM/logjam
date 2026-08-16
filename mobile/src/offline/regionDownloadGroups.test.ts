import { describe, expect, it } from "vitest";

import { groupRegionJobs, regionGroupToastText } from "./regionDownloadGroups";
import type { RegionJob, RegionJobState } from "./regionDownloadQueue";

function job(
  id: string,
  groupId: string,
  state: RegionJobState,
  progress: Partial<RegionJob["progress"]> = {},
): RegionJob {
  return {
    spec: {
      taskKind: "tile-pyramid",
      id,
      basemapId: "six-topo",
      label: "SIX Maps Topo",
      groupId,
      groupLabel: "Blue Gum Forest",
      bbox: { west: 150, south: -34, east: 151, north: -33 },
      zMax: 15,
      allowCellular: false,
    },
    state,
    progress: {
      tilesDone: 0,
      tilesTotal: 0,
      tilesGap: 0,
      tilesFailed: 0,
      bytesDone: 0,
      bytesTotal: 0,
      ...progress,
    },
  };
}

describe("groupRegionJobs", () => {
  it("aggregates one card per run", () => {
    const groups = groupRegionJobs([
      job("a", "run-1", { kind: "ready", gaps: 0, failed: 0 }),
      job("b", "run-1", { kind: "downloading" }, { tilesDone: 25, tilesTotal: 100 }),
      job("c", "run-2", { kind: "queued" }),
    ]);
    expect(groups.map((g) => g.groupId)).toEqual(["run-1", "run-2"]);
    expect(groups[0].ready).toBe(1);
    expect(groups[0].unfinished).toBe(1);
    expect(groups[0].fraction).toBeCloseTo(0.625);
    expect(groups[0].settled).toBe(false);
    expect(groups[0].done).toBe(false);
  });

  it("measures a byte-counted job (the vector clip reports no tiles)", () => {
    const [group] = groupRegionJobs([
      job("a", "run-1", { kind: "downloading" }, { bytesDone: 5, bytesTotal: 10 }),
    ]);
    expect(group.fraction).toBeCloseTo(0.5);
  });

  it("settles on a failure and on a park nothing auto-resumes", () => {
    const [group] = groupRegionJobs([
      job("a", "run-1", { kind: "failed", code: "unknown" }),
      job("b", "run-1", { kind: "paused", reason: "provider-backoff" }),
    ]);
    expect(group.settled).toBe(true);
    expect(group.done).toBe(false);
    // A park the app clears by itself is NOT settled — the run is still live.
    const [live] = groupRegionJobs([job("a", "run-1", { kind: "paused", reason: "background" })]);
    expect(live.settled).toBe(false);
  });
});

describe("regionGroupToastText", () => {
  const base = groupRegionJobs([
    job("a", "run-1", { kind: "ready", gaps: 0, failed: 0 }),
    job("b", "run-1", { kind: "ready", gaps: 0, failed: 0 }),
    job("c", "run-1", { kind: "ready", gaps: 0, failed: 0 }),
  ])[0];

  it("names the area and the tally", () => {
    expect(regionGroupToastText(base)).toBe("Blue Gum Forest saved · 3 maps");
  });

  it("says how many didn't finish", () => {
    expect(regionGroupToastText({ ...base, ready: 2, unfinished: 1 })).toBe(
      "Blue Gum Forest saved · 2 maps · 1 map didn't finish",
    );
  });

  it("does not claim a save when nothing landed", () => {
    expect(regionGroupToastText({ ...base, ready: 0, unfinished: 3 })).toBe(
      "Blue Gum Forest · nothing saved · 3 maps didn't finish",
    );
  });
});
