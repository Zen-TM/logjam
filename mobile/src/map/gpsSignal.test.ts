import { describe, expect, it } from "vitest";

import {
  deliveredFix,
  FIX_COARSE_M,
  FIX_STALE_MS,
  fixAgeLabel,
  fixQuality,
  nextFix,
} from "./gpsSignal";

const NOW = 1_700_000_000_000;

describe("fixQuality", () => {
  it("trusts a recent, precise fix", () => {
    expect(fixQuality({ atMs: NOW - 3000, accuracyM: 8 }, NOW)).toBe("live");
  });

  it("goes stale when nothing has arrived for the window", () => {
    expect(
      fixQuality({ atMs: NOW - FIX_STALE_MS - 1, accuracyM: 8 }, NOW),
    ).toBe("stale");
  });

  it("does not go stale over an ordinary skipped fix", () => {
    expect(
      fixQuality({ atMs: NOW - FIX_STALE_MS + 1, accuracyM: 8 }, NOW),
    ).toBe("live");
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
    expect(fixQuality({ atMs: NOW - 3_600_000, accuracyM: 5 }, NOW)).toBe(
      "stale",
    );
  });

  it("has nothing to trust before the first fix", () => {
    expect(fixQuality(null, NOW)).toBe("stale");
  });
});

describe("deliveredFix", () => {
  // Mutation: return `{ atMs: <platform timestamp>, ... }` and a skewed device
  // clock greys every live fix.
  it("stamps a delivery with our clock, whatever the platform said", () => {
    expect(fixQuality(deliveredFix(8, NOW), NOW + 1000)).toBe("live");
  });
});

describe("nextFix", () => {
  // Mutation: compare atMs (return the later of the two) and a device clock
  // behind GNSS time rejects the live fix for a cached one stamped ahead.
  it("a live delivery wins even when the cached fix reads as newer", () => {
    const cachedAhead = { atMs: Date.now() + 600_000, accuracyM: 5 };
    const live = deliveredFix(5, Date.now());
    expect(nextFix(cachedAhead, live, false)).toBe(live);
  });

  // Mutation: return `incoming` always and a restarted watcher's cached fix
  // overwrites the live one.
  it("the cached fix only fills an empty slot", () => {
    const live = { atMs: NOW, accuracyM: 5 };
    const cached = { atMs: NOW - 600_000, accuracyM: 5 };
    expect(nextFix(live, cached, true)).toBe(live);
    expect(nextFix(null, cached, true)).toBe(cached);
  });
});

describe("fixAgeLabel", () => {
  it("counts seconds, then minutes, then hours", () => {
    expect(fixAgeLabel(21_000)).toBe("21 s ago");
    expect(fixAgeLabel(125_000)).toBe("2 min ago");
    expect(fixAgeLabel(3 * 3_600_000)).toBe("3 h ago");
  });
});
