import { describe, expect, it } from "vitest";

import { DEM_SOURCE_ID, type DownloadableTileSourceId } from "@logjam/shared";

import { groupRegionJobs, regionGroupToastText } from "./regionDownloadGroups";
import type { RegionJob, RegionJobState } from "./regionDownloadQueue";

function job(
  id: string,
  groupId: string,
  state: RegionJobState,
  progress: Partial<RegionJob["progress"]> = {},
  basemapId: DownloadableTileSourceId = "six-topo",
): RegionJob {
  return {
    spec: {
      taskKind: "tile-pyramid",
      id,
      basemapId,
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

describe("the DEM that rides along with every run", () => {
  const demJob = (state: RegionJobState) =>
    job("dem", "run-1", state, {}, DEM_SOURCE_ID);

  it("finishing every map is not finishing the run", () => {
    const [group] = groupRegionJobs([
      job("a", "run-1", { kind: "ready", gaps: 0, failed: 0 }),
      demJob({ kind: "downloading" }),
    ]);
    expect(group.unfinished).toBe(0);
    expect(group.done).toBe(false);
    const [finished] = groupRegionJobs([
      job("a", "run-1", { kind: "ready", gaps: 0, failed: 0 }),
      demJob({ kind: "ready", gaps: 0, failed: 0 }),
    ]);
    expect(finished.done).toBe(true);
  });

  it("is work, but is not one of the maps", () => {
    const [group] = groupRegionJobs([
      job("a", "run-1", { kind: "ready", gaps: 0, failed: 0 }),
      demJob({ kind: "downloading" }),
    ]);
    expect(group.mapCount).toBe(1);
    expect(group.ready).toBe(1);
    expect(group.unfinished).toBe(0);
    // Still half the run's progress, and still not finished.
    expect(group.fraction).toBeCloseTo(0.5);
    expect(group.done).toBe(false);
  });

  it("says so when the maps landed and the elevation data didn't", () => {
    const [group] = groupRegionJobs([
      job("a", "run-1", { kind: "ready", gaps: 0, failed: 0 }),
      demJob({ kind: "failed", code: "unknown" }),
    ]);
    expect(group.demUnfinished).toBe(true);
    expect(regionGroupToastText(group)).toBe(
      "Blue Gum Forest saved · 1 map · no elevation data",
    );
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
