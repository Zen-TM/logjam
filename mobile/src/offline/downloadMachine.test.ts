import { describe, expect, it } from "vitest";

import {
  initialStatus,
  isActive,
  recoverOnColdStart,
  transition,
  type DownloadStatus,
} from "./downloadMachine";

function runPath(events: Parameters<typeof transition>[1][]): DownloadStatus {
  return events.reduce(transition, initialStatus);
}

describe("download state machine", () => {
  it("walks the happy path to ready", () => {
    const status = runPath([
      { type: "start" },
      { type: "enumerated" },
      { type: "downloaded" },
      { type: "finalized" },
      { type: "verified" },
    ]);
    expect(status).toEqual({ state: "ready", pausedReason: null, errorCode: null });
    expect(isActive(status.state)).toBe(false);
  });

  it("pause/resume round-trips downloading", () => {
    const paused = runPath([
      { type: "start" },
      { type: "enumerated" },
      { type: "pause", reason: "connectivity" },
    ]);
    expect(paused).toEqual({
      state: "paused",
      pausedReason: "connectivity",
      errorCode: null,
    });
    expect(transition(paused, { type: "resume" }).state).toBe("downloading");
  });

  it("cancel is legal from any active state, illegal from terminal", () => {
    for (const events of [
      [],
      [{ type: "start" } as const],
      [{ type: "start" } as const, { type: "enumerated" } as const],
    ]) {
      expect(runPath([...events, { type: "cancel" }]).state).toBe("canceled");
    }
    const ready = runPath([
      { type: "start" },
      { type: "enumerated" },
      { type: "downloaded" },
      { type: "finalized" },
      { type: "verified" },
    ]);
    expect(() => transition(ready, { type: "cancel" })).toThrow();
  });

  it("fail carries the error code", () => {
    const failed = runPath([
      { type: "start" },
      { type: "enumerated" },
      { type: "fail", code: "provider-errors" },
    ]);
    expect(failed).toEqual({
      state: "failed",
      pausedReason: null,
      errorCode: "provider-errors",
    });
  });

  it("throws on mis-sequenced events", () => {
    expect(() => transition(initialStatus, { type: "downloaded" })).toThrow();
    expect(() => transition(initialStatus, { type: "resume" })).toThrow();
    const downloading = runPath([{ type: "start" }, { type: "enumerated" }]);
    expect(() => transition(downloading, { type: "verified" })).toThrow();
  });

  it("cold-start parks mid-flight states as paused(background)", () => {
    const downloading = runPath([{ type: "start" }, { type: "enumerated" }]);
    expect(recoverOnColdStart(downloading)).toEqual({
      state: "paused",
      pausedReason: "background",
      errorCode: null,
    });
    const ready = runPath([
      { type: "start" },
      { type: "enumerated" },
      { type: "downloaded" },
      { type: "finalized" },
      { type: "verified" },
    ]);
    expect(recoverOnColdStart(ready)).toBe(ready);
    expect(recoverOnColdStart(initialStatus)).toBe(initialStatus);
  });
});
