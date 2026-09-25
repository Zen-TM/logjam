import { describe, expect, it } from "vitest";

import type { RegionJob } from "./regionDownloadQueue";
import { canPause, isJobFinished, isJobSettled, isJobStalled } from "./regionJobStatus";

// Two regressions, one file. (1) `Done` was gated on ready|failed, so a job
// parked by a provider 403/429 — which nothing auto-resumes, by design — left
// the button disabled forever on a screen whose only other exits were hardware
// back or Stop (which deletes the tiles). (2) Pause was offered on the vector
// clip, where it does nothing at all.

const job = (state: RegionJob["state"], taskKind = "tile-pyramid"): RegionJob =>
  ({ spec: { id: "j", taskKind }, state, progress: {} }) as unknown as RegionJob;

describe("the Done gate", () => {
  it("counts finished jobs, either way", () => {
    expect(isJobSettled(job({ kind: "ready", gaps: 0, failed: 0 }))).toBe(true);
    expect(isJobSettled(job({ kind: "failed", code: "unknown" }))).toBe(true);
  });

  it("counts a job nothing will ever resume — the trap", () => {
    expect(isJobSettled(job({ kind: "paused", reason: "provider-backoff" }))).toBe(true);
    expect(isJobSettled(job({ kind: "paused", reason: "user" }))).toBe(true);
  });

  it("does NOT count a job that resumes itself", () => {
    // These two come back on their own (foreground, reconnect), so the screen
    // is still telling the truth by holding the user.
    expect(isJobSettled(job({ kind: "paused", reason: "background" }))).toBe(false);
    expect(isJobSettled(job({ kind: "paused", reason: "connectivity" }))).toBe(false);
    expect(isJobSettled(job({ kind: "queued" }))).toBe(false);
    expect(isJobSettled(job({ kind: "downloading" }))).toBe(false);
  });

  it("keeps a stalled job's own actions on offer", () => {
    // Settled for the gate, NOT finished — the row still shows Resume/Stop.
    const stalled = job({ kind: "paused", reason: "provider-backoff" });
    expect(isJobStalled(stalled)).toBe(true);
    expect(isJobFinished(stalled)).toBe(false);
  });
});

describe("pause", () => {
  it("is offered on a tile pyramid and hidden on the one-shot clip", () => {
    expect(canPause(job({ kind: "downloading" }))).toBe(true);
    expect(canPause(job({ kind: "downloading" }, "http-file"))).toBe(false);
  });
});
