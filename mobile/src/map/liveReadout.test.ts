import { describe, expect, it } from "vitest";

import { deriveSpeedMps, READOUT_STALE_MS } from "./liveReadout";

const at = (atMs: number, speedMps: number | null, lat = -33.56, lon = 150.4) => ({
  lat,
  lon,
  speedMps,
  atMs,
});

describe("deriveSpeedMps", () => {
  it("believes the platform's own speed when it has one", () => {
    expect(deriveSpeedMps(at(3000, 1.4), at(0, null))).toBe(1.4);
  });

  it("keeps a reported standstill as zero, not as unknown", () => {
    expect(deriveSpeedMps(at(3000, 0), at(0, null))).toBe(0);
  });

  it("differences two fixes when the platform won't say", () => {
    // ~100 m of longitude at this latitude, over 10 s.
    const previous = at(0, null, -33.56, 150.4);
    const current = at(10_000, -1, -33.56, 150.4 + 0.001077);
    const speed = deriveSpeedMps(current, previous);
    expect(speed).not.toBeNull();
    expect(speed!).toBeGreaterThan(9);
    expect(speed!).toBeLessThan(11);
  });

  it("refuses a gap too short to be travel — that is delivery jitter", () => {
    const previous = at(0, null, -33.56, 150.4);
    const current = at(200, null, -33.56, 150.40005);
    expect(deriveSpeedMps(current, previous)).toBeNull();
  });

  it("refuses a gap long enough to be a different question", () => {
    const previous = at(0, null, -33.56, 150.4);
    const current = at(READOUT_STALE_MS + 1000, null, -33.56, 150.41);
    expect(deriveSpeedMps(current, previous)).toBeNull();
  });

  it("has no answer at all on the first fix with no platform speed", () => {
    expect(deriveSpeedMps(at(0, null), null)).toBeNull();
    expect(deriveSpeedMps(at(0, -1), null)).toBeNull();
  });
});
