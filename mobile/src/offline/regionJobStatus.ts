// When is a region download "done with", and when may a screen let the user go?
//
// `Done` is gated on jobs being settled, not just `ready` or `failed`: the queue
// parks jobs as `paused` for four reasons and deliberately auto-resumes only two
// of them (`background`, `connectivity`). A job halted by a provider 403/429 parks
// as `paused("provider-backoff")` and will not auto-resume; leaving Done disabled
// would trap the user on a dead end whose only exit deletes the tiles
// (regionJobStatus.test.ts).
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

/**
 * Why the server refused this area: its own sentence, as it is (shared/DESIGN.md
 * §11). A job that failed before the phone kept that sentence holds one of two
 * codes instead, and a response with no sentence holds nothing.
 */
export function regionRejectedLine(detail: string | undefined): string {
  if (detail === "too-large")
    return "Pick a smaller area — up to 40 km across.";
  if (detail === "outside-nsw" || !detail) return "Pick an area inside NSW.";
  return detail;
}

/** Nothing more will happen unless the user asks — the "may I leave?" gate. */
export function isJobSettled(job: RegionJob): boolean {
  return isJobFinished(job) || isJobStalled(job);
}

/**
 * Pause can only be honoured on the tile-pyramid task: the vector clip is one
 * `expo-file-system` transfer with no mid-flight stop
 * (regionJobStatus.test.ts).
 */
export function canPause(job: RegionJob): boolean {
  return job.spec.taskKind === "tile-pyramid";
}
