// A running "Save maps offline" run, as ONE card.
//
// The queue holds a job per basemap and they run one after another (the
// politeness envelope is per-provider). The user asked for an AREA, so Saved
// shows the run as a single progress card — the per-job detail lives one tap
// behind it. Same grouping key the finished artifacts use (`groupId`).
//
// Pure, so the aggregation the card and the finish toast both read has one
// definition and a test beside it.
import { DEM_SOURCE_ID } from "@logjam/shared";

import { isJobSettled } from "./regionJobStatus";
import type { RegionJob } from "./regionDownloadQueue";

export type RegionDownloadGroup = {
  groupId: string;
  label: string;
  jobs: RegionJob[];
  /**
   * How many of those jobs are MAPS. Every run also downloads the DEM, which is
   * real work (it counts in `fraction`, `settled` and `done`) but is not a map
   * the user picked — counting it would report three maps saved to someone who
   * chose two.
   */
  mapCount: number;
  ready: number;
  /** Maps that will not become a saved map without the user asking again. */
  unfinished: number;
  /** The area saved, but its elevation data didn't. Worth saying out loud. */
  demUnfinished: boolean;
  /** 0–1 across the whole run — jobs already saved count as done. */
  fraction: number;
  /** Nothing more will happen on its own: the moment to announce the run. */
  settled: boolean;
  /** Every job saved — the card has nothing left to say. */
  done: boolean;
};

function jobFraction(job: RegionJob): number {
  if (job.state.kind === "ready") return 1;
  const { tilesDone, tilesTotal, bytesDone, bytesTotal } = job.progress;
  if (tilesTotal > 0) return Math.min(1, tilesDone / tilesTotal);
  if (bytesTotal > 0) return Math.min(1, bytesDone / bytesTotal);
  return 0;
}

export function groupRegionJobs(jobs: RegionJob[]): RegionDownloadGroup[] {
  const groups = new Map<string, RegionJob[]>();
  for (const job of jobs) {
    const list = groups.get(job.spec.groupId);
    if (list) list.push(job);
    else groups.set(job.spec.groupId, [job]);
  }
  return [...groups.entries()].map(([groupId, groupJobs]) => {
    const mapJobs = groupJobs.filter((job) => job.spec.basemapId !== DEM_SOURCE_ID);
    const ready = mapJobs.filter((job) => job.state.kind === "ready").length;
    return {
      groupId,
      // Every job of a run carries the same label; the last write wins if a
      // rename landed mid-run.
      label: groupJobs[groupJobs.length - 1].spec.groupLabel,
      jobs: groupJobs,
      mapCount: mapJobs.length,
      ready,
      unfinished: mapJobs.length - ready,
      demUnfinished: groupJobs.some(
        (job) => job.spec.basemapId === DEM_SOURCE_ID && job.state.kind !== "ready",
      ),
      fraction:
        groupJobs.reduce((sum, job) => sum + jobFraction(job), 0) / groupJobs.length,
      settled: groupJobs.every(isJobSettled),
      // Over EVERY job, not `ready === mapCount`: `ready` counts maps only, so
      // comparing it to the job count left a finished run permanently
      // unfinished — a red "0 maps didn't finish" card that never cleared.
      done: groupJobs.every((job) => job.state.kind === "ready"),
    };
  });
}

function maps(count: number): string {
  return `${count} map${count === 1 ? "" : "s"}`;
}

/** What the finish toast says. Names the area and both tallies, never a bbox. */
export function regionGroupToastText(group: RegionDownloadGroup): string {
  const saved =
    group.ready > 0
      ? `${group.label} saved · ${maps(group.ready)}`
      : `${group.label} · nothing saved`;
  const withMaps =
    group.unfinished > 0 ? `${saved} · ${maps(group.unfinished)} didn't finish` : saved;
  // Named rather than folded into the map tally: the consequence is specific
  // (no elevation profiles out there), and it is not fixed by re-picking maps.
  return group.demUnfinished ? `${withMaps} · no elevation data` : withMaps;
}
