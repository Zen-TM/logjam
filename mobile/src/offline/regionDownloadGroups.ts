// A running "Save maps offline" run, as ONE card.
//
// The queue holds a job per basemap and they run one after another (the
// politeness envelope is per-provider). The user asked for an AREA, so Saved
// shows the run as a single progress card — the per-job detail lives one tap
// behind it. Same grouping key the finished artifacts use (`groupId`).
//
// Pure, so the aggregation the card and the finish toast both read has one
// definition and a test beside it.
import { isJobSettled } from "./regionJobStatus";
import type { RegionJob } from "./regionDownloadQueue";

export type RegionDownloadGroup = {
  groupId: string;
  label: string;
  jobs: RegionJob[];
  ready: number;
  /** Jobs that will not become a saved map without the user asking again. */
  unfinished: number;
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
    const ready = groupJobs.filter((job) => job.state.kind === "ready").length;
    return {
      groupId,
      // Every job of a run carries the same label; the last write wins if a
      // rename landed mid-run.
      label: groupJobs[groupJobs.length - 1].spec.groupLabel,
      jobs: groupJobs,
      ready,
      unfinished: groupJobs.length - ready,
      fraction:
        groupJobs.reduce((sum, job) => sum + jobFraction(job), 0) / groupJobs.length,
      settled: groupJobs.every(isJobSettled),
      done: ready === groupJobs.length,
    };
  });
}

function maps(count: number): string {
  return `${count} map${count === 1 ? "" : "s"}`;
}

/** What the finish toast says. Names the area and both tallies, never a bbox. */
export function regionGroupToastText(group: RegionDownloadGroup): string {
  const saved = group.ready > 0 ? `${group.label} saved · ${maps(group.ready)}` : `${group.label} · nothing saved`;
  return group.unfinished > 0
    ? `${saved} · ${maps(group.unfinished)} didn't finish`
    : saved;
}
