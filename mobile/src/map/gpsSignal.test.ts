import { describe, expect, it } from "vitest";

import { FIX_COARSE_M, FIX_STALE_MS, fixQuality } from "./gpsSignal";

const NOW = 1_700_000_000_000;

describe("fixQuality", () => {
  it("trusts a recent, precise fix", () => {
    expect(fixQuality({ atMs: NOW - 3000, accuracyM: 8 }, NOW)).toBe("live");
  });

  it("goes stale when nothing has arrived for the window", () => {
    expect(fixQuality({ atMs: NOW - FIX_STALE_MS - 1, accuracyM: 8 }, NOW)).toBe(
      "stale",
    );
  });

  it("does not go stale over an ordinary skipped fix", () => {
    expect(fixQuality({ atMs: NOW - FIX_STALE_MS + 1, accuracyM: 8 }, NOW)).toBe(
      "live",
    );
  });

  it("calls a tower-sized accuracy coarse", () => {
    expect(
      fixQuality({ atMs: NOW - 1000, accuracyM: FIX_COARSE_M + 1 }, NOW),
    ).toBe("coarse");
  });

  it("leaves a merely mediocre fix alone", () => {
    expect(fixQuality({ atMs: NOW - 1000, accuracyM: 40 }, NOW)).toBe("live");
  });

  // The order matters for the message the user is shown: "no signal" is the
  // true statement about an old tower fix, "weak signal" is not.
  it("reports stale rather than coarse when it is both", () => {
    expect(
      fixQuality({ atMs: NOW - FIX_STALE_MS - 1, accuracyM: 2000 }, NOW),
    ).toBe("stale");
  });

  it("does not grey on an accuracy the platform withheld", () => {
    expect(fixQuality({ atMs: NOW - 1000, accuracyM: null }, NOW)).toBe("live");
  });

  // The cached fix the watcher applies on startup is a real position from a
  // real time, and that time can be yesterday's drive.
  it("treats a stale cached fix as stale, not as a first fix", () => {
    expect(fixQuality({ atMs: NOW - 3_600_000, accuracyM: 5 }, NOW)).toBe("stale");
  });

  it("has nothing to trust before the first fix", () => {
    expect(fixQuality(null, NOW)).toBe("stale");
  });
});
