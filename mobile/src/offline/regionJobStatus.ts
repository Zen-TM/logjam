// When is a region download "done with", and when may a screen let the user go?
//
// Two different questions, and the progress screen answered only the first.
// `Done` was gated on every job being `ready` or `failed`, but the queue parks
// jobs as `paused` for four reasons and deliberately auto-resumes only two of
// them (`background`, `connectivity`). A job halted by a provider 403/429 parks
// as `paused("provider-backoff")` and NOTHING will ever move it: Done stayed
// disabled forever, Resume re-entered the same halt, and on a phone without a
// hardware back gesture the screen was a dead end whose only exit deleted the
// tiles.
//
// The file is a lossless checkpoint and the region is offered again in the
// layers sheet's Unfinished list, so leaving a stalled job is safe — it just
// must not be called "saved".
import type { RegionJob } from "./regionDownloadQueue";
import type { RegionFailureCode } from "./regionTileDownload";

/** Finished, one way or the other. A failure is a finished download too. */
export function isJobFinished(job: RegionJob): boolean {
  return job.state.kind === "ready" || job.state.kind === "failed";
}

/**
 * Parked for a reason nothing in the app will clear on its own — the user's own
 * decision, or the politeness envelope's. Neither is ours to overturn (see
 * `resumeJobsPausedBy`), so waiting on one is waiting forever.
 */
export function isJobStalled(job: RegionJob): boolean {
  return (
    job.state.kind === "paused" &&
    (job.state.reason === "user" || job.state.reason === "provider-backoff")
  );
}

/**
 * Is another attempt at this failure worth offering?
 *
 * `region-rejected` is the server refusing THIS AREA, and `source-unavailable`
 * an endpoint that will keep refusing until an operator fixes it — Resume on
 * either repeats the same failure and teaches the user the button is a lie.
 * Everything else (a dropped connection, a locked database, a batch of tiles
 * that wouldn't load) is worth another go against the partial file, which is a
 * lossless checkpoint.
 */
export function isRetryableFailure(code: RegionFailureCode): boolean {
  return code !== "region-rejected" && code !== "source-unavailable";
}

/** Nothing more will happen unless the user asks — the "may I leave?" gate. */
export function isJobSettled(job: RegionJob): boolean {
  return isJobFinished(job) || isJobStalled(job);
}

/**
 * Pause can only be honoured on the tile-pyramid task: the vector clip is one
 * `expo-file-system` transfer with no mid-flight stop, so the button did
 * nothing — the bytes kept coming (up to 80 MB) and the row settled "ready"
 * while the UI said "Paused". An affordance that lies is worse than none.
 */
export function canPause(job: RegionJob): boolean {
  return job.spec.taskKind === "tile-pyramid";
}
