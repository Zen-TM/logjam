import { describe, expect, it } from "vitest";

import {
  ELEVATION_HYSTERESIS_M,
  MAX_ACCEPTED_ACCURACY_M,
  compassPointFor,
  computeTrackStats,
  formatDistanceM,
  formatDurationMs,
  initialBearingDegrees,
  recordedDurationMs,
  rejectTrackFix,
  type RecordedTrackPoint,
} from "./trackStats.js";

// Synthetic coords only (repo rule): 150.2–150.3 E, −33.6–−33.7 S.
const BASE_LAT = -33.65;
const BASE_LON = 150.25;

// 0.001° of latitude ≈ 111.19 m everywhere.
const LAT_STEP_M_PER_MILLIDEG = 111.19;

function point(
  overrides: Partial<RecordedTrackPoint> & { timestampMs: number },
): RecordedTrackPoint {
  return {
    lon: BASE_LON,
    lat: BASE_LAT,
    altitudeM: null,
    accuracyM: 10,
    segment: 0,
    ...overrides,
  };
}

describe("rejectTrackFix", () => {
  const prev = point({ timestampMs: 1000 });

  // 0.001° of latitude in 100 s is 1.1 m/s — a walking pace, under the
  // plausibility ceiling. (Covering it in 1 s would be 111 m/s.)
  const WALK_MS = 100_000;

  it("accepts a clean fix", () => {
    expect(
      rejectTrackFix(
        prev,
        point({ lat: BASE_LAT + 0.001, timestampMs: 1000 + WALK_MS }),
      ),
    ).toBeNull();
  });

  it("accepts the first fix of a track (no prev)", () => {
    expect(rejectTrackFix(null, point({ timestampMs: 1000 }))).toBeNull();
  });

  it("rejects non-finite and out-of-range coordinates", () => {
    expect(rejectTrackFix(null, point({ lat: NaN, timestampMs: 1 }))).toBe(
      "invalid",
    );
    expect(rejectTrackFix(null, point({ lon: 181, timestampMs: 1 }))).toBe(
      "invalid",
    );
    expect(rejectTrackFix(null, point({ lat: 91, timestampMs: 1 }))).toBe(
      "invalid",
    );
  });

  it("rejects fixes above the accuracy ceiling, keeps null accuracy", () => {
    expect(
      rejectTrackFix(
        prev,
        point({
          lat: BASE_LAT + 0.001,
          accuracyM: MAX_ACCEPTED_ACCURACY_M + 1,
          timestampMs: 2000,
        }),
      ),
    ).toBe("inaccurate");
    expect(
      rejectTrackFix(
        prev,
        point({
          lat: BASE_LAT + 0.001,
          accuracyM: null,
          timestampMs: 1000 + WALK_MS,
        }),
      ),
    ).toBeNull();
  });

  it("takes the caller's accuracy ceiling, and 0 disables it", () => {
    const rough = point({
      lat: BASE_LAT + 0.001,
      accuracyM: 80,
      timestampMs: 1000 + WALK_MS,
    });
    // Tighter than the default: a fix the default would keep is dropped.
    expect(rejectTrackFix(prev, rough, 20)).toBe("inaccurate");
    // Looser: the same fix lands.
    expect(rejectTrackFix(prev, rough, 100)).toBeNull();
    // 0 = keep all, which is the whole point of the setting — a slot where
    // nothing better than 80 m is on offer still records.
    expect(rejectTrackFix(prev, rough, 0)).toBeNull();
  });

  it("keeps the movement gate whatever the accuracy ceiling is", () => {
    // The drift gate scales with the fix's own accuracy, so a 200 m-accurate
    // fix 1 m away is still drift — "keep all" must not turn a stationary
    // phone's wander into distance walked.
    expect(
      rejectTrackFix(
        prev,
        point({ lat: BASE_LAT + 0.000005, accuracyM: 200, timestampMs: 5000 }),
        0,
      ),
    ).toBe("too-close");
  });

  it("rejects out-of-order and duplicate timestamps", () => {
    expect(
      rejectTrackFix(prev, point({ lat: BASE_LAT + 0.001, timestampMs: 1000 })),
    ).toBe("out-of-order");
    expect(
      rejectTrackFix(prev, point({ lat: BASE_LAT + 0.001, timestampMs: 999 })),
    ).toBe("out-of-order");
  });

  it("rejects sub-threshold movement (replayed last fix)", () => {
    expect(rejectTrackFix(prev, point({ timestampMs: 2000 }))).toBe("too-close");
  });
});

describe("computeTrackStats", () => {
  it("empty and single-point tracks are zero", () => {
    expect(computeTrackStats([])).toEqual({
      distanceM: 0,
      durationMs: 0,
      elevationGainM: 0,
      elevationLossM: 0,
      pointCount: 0,
    });
    expect(computeTrackStats([point({ timestampMs: 0 })]).distanceM).toBe(0);
  });

  it("sums haversine distance along a latitude line", () => {
    // 10 steps of 0.001° lat ≈ 10 × 111.19 m.
    const points = Array.from({ length: 11 }, (_, i) =>
      point({ lat: BASE_LAT + i * 0.001, timestampMs: i * 10_000 }),
    );
    const stats = computeTrackStats(points);
    expect(stats.distanceM).toBeCloseTo(10 * LAT_STEP_M_PER_MILLIDEG, 0);
    expect(stats.durationMs).toBe(100_000);
    expect(stats.pointCount).toBe(11);
  });

  it("excludes the pause gap from distance and duration (segment break)", () => {
    const points = [
      point({ lat: BASE_LAT, timestampMs: 0, segment: 0 }),
      point({ lat: BASE_LAT + 0.001, timestampMs: 10_000, segment: 0 }),
      // 30-minute pause, user teleported 0.01° away.
      point({ lat: BASE_LAT + 0.011, timestampMs: 1_810_000, segment: 1 }),
      point({ lat: BASE_LAT + 0.012, timestampMs: 1_820_000, segment: 1 }),
    ];
    const stats = computeTrackStats(points);
    expect(stats.distanceM).toBeCloseTo(2 * LAT_STEP_M_PER_MILLIDEG, 0);
    expect(stats.durationMs).toBe(20_000);
  });

  it("altitude sawtooth below the hysteresis threshold accumulates nothing", () => {
    const jitter = ELEVATION_HYSTERESIS_M / 2;
    const points = Array.from({ length: 40 }, (_, i) =>
      point({
        lat: BASE_LAT + i * 0.001,
        altitudeM: 600 + (i % 2 === 0 ? 0 : jitter),
        timestampMs: i * 10_000,
      }),
    );
    const stats = computeTrackStats(points);
    expect(stats.elevationGainM).toBe(0);
    expect(stats.elevationLossM).toBe(0);
  });

  it("counts a real climb-then-descend once each", () => {
    // 600 → 700 in 10 m steps, then back down to 650.
    const up = Array.from({ length: 11 }, (_, i) =>
      point({
        lat: BASE_LAT + i * 0.001,
        altitudeM: 600 + i * 10,
        timestampMs: i * 10_000,
      }),
    );
    const down = Array.from({ length: 5 }, (_, i) =>
      point({
        lat: BASE_LAT + (11 + i) * 0.001,
        altitudeM: 690 - i * 10,
        timestampMs: (11 + i) * 10_000,
      }),
    );
    const stats = computeTrackStats([...up, ...down]);
    // 90/40, not 100/50: the altitude median clips a SHARP summit by roughly
    // half a window of climb (here 10 m/sample × 1 sample). That is the price
    // of the smoothing, and it is the right trade — the same series without
    // it reads thousands of metres of gain once real GPS noise is present
    // (see the random-walk test below).
    expect(stats.elevationGainM).toBe(90);
    expect(stats.elevationLossM).toBe(40);
  });

  it("skips null altitudes without breaking the elevation series", () => {
    const points = [
      point({ altitudeM: 600, timestampMs: 0 }),
      point({ lat: BASE_LAT + 0.001, altitudeM: null, timestampMs: 10_000 }),
      point({ lat: BASE_LAT + 0.002, altitudeM: 650, timestampMs: 20_000 }),
    ];
    expect(computeTrackStats(points).elevationGainM).toBe(50);
  });

  it("elevation runs across segments (climb made while paused still counts)", () => {
    const points = [
      point({ altitudeM: 600, timestampMs: 0, segment: 0 }),
      point({ lat: BASE_LAT + 0.001, altitudeM: 610, timestampMs: 10_000, segment: 0 }),
      point({ lat: BASE_LAT + 0.002, altitudeM: 700, timestampMs: 600_000, segment: 1 }),
    ];
    expect(computeTrackStats(points).elevationGainM).toBe(100);
  });
});

describe("initialBearingDegrees / compassPointFor", () => {
  it("cardinal directions", () => {
    expect(
      initialBearingDegrees(BASE_LAT, BASE_LON, BASE_LAT + 0.01, BASE_LON),
    ).toBeCloseTo(0, 5);
    expect(
      initialBearingDegrees(BASE_LAT, BASE_LON, BASE_LAT - 0.01, BASE_LON),
    ).toBeCloseTo(180, 5);
    // Due east/west along a parallel: initial bearing off 90/270 by the
    // convergence term — tiny at 0.01°.
    expect(
      initialBearingDegrees(BASE_LAT, BASE_LON, BASE_LAT, BASE_LON + 0.01),
    ).toBeCloseTo(90, 1);
    expect(
      initialBearingDegrees(BASE_LAT, BASE_LON, BASE_LAT, BASE_LON - 0.01),
    ).toBeCloseTo(270, 1);
  });

  it("compass points wrap and round", () => {
    expect(compassPointFor(0)).toBe("N");
    expect(compassPointFor(44)).toBe("NE");
    expect(compassPointFor(359)).toBe("N");
    expect(compassPointFor(225)).toBe("SW");
    expect(compassPointFor(-45)).toBe("NW");
  });
});

describe("formatters", () => {
  it("formats distance", () => {
    expect(formatDistanceM(950)).toBe("950 m");
    expect(formatDistanceM(1050)).toBe("1.1 km");
    expect(formatDistanceM(NaN)).toBe("—");
  });

  it("formats duration", () => {
    expect(formatDurationMs(47 * 60_000)).toBe("47 min");
    expect(formatDurationMs(192 * 60_000)).toBe("3 h 12 min");
    expect(formatDurationMs(-1)).toBe("—");
  });
});

// --- Noise regressions -----------------------------------------------------
//
// The sawtooth cases above are the signal the OLD constants were tuned for,
// and they passed while a phone sitting still on a rock recorded 10.5 km and
// 3.2 km of ascent. Real GPS error is a RANDOM WALK, not a sawtooth: it
// wanders past any fixed per-sample threshold given enough samples. These
// feed simulated noise through the whole pipeline — acceptance gate first,
// then stats — which is the only way the two interact.

/** Deterministic LCG: these assertions must not flake. */
function makeNoise(seed: number): (sigma: number) => number {
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  return (sigma) => {
    const u = Math.max(next(), 1e-9);
    return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
}

const M_PER_DEG_LAT = 111_132;
const M_PER_DEG_LON = 111_320 * Math.cos((BASE_LAT * Math.PI) / 180);

/** Simulate a walk east at `speedMps` under gaussian fix noise. */
function simulate(options: {
  minutes: number;
  speedMps: number;
  sigmaM: number;
  accuracyM: number;
  climbM: number;
}): RecordedTrackPoint[] {
  const { minutes, speedMps, sigmaM, accuracyM, climbM } = options;
  const noise = makeNoise(42);
  const stepMs = 3000;
  const samples = Math.floor((minutes * 60_000) / stepMs);
  const accepted: RecordedTrackPoint[] = [];
  let prev: RecordedTrackPoint | null = null;
  for (let i = 0; i < samples; i++) {
    const eastM = speedMps * ((i * stepMs) / 1000);
    const fix = {
      lat: BASE_LAT + noise(sigmaM) / M_PER_DEG_LAT,
      lon: BASE_LON + (eastM + noise(sigmaM)) / M_PER_DEG_LON,
      altitudeM: 500 + (climbM * i) / samples + noise(sigmaM),
      accuracyM,
      timestampMs: 1_700_000_000_000 + i * stepMs,
    };
    if (rejectTrackFix(prev, fix) !== null) continue;
    const point: RecordedTrackPoint = { ...fix, segment: 0 };
    accepted.push(point);
    prev = point;
  }
  return accepted;
}

describe("noise rejection (random walk, not sawtooth)", () => {
  it("a phone sitting still for 20 minutes records almost nothing", () => {
    // 30 m-accurate fixes, 15 m of drift each way. Before the accuracy-scaled
    // gate this read 10.53 km walked and 3216 m climbed.
    const stats = computeTrackStats(
      simulate({
        minutes: 20,
        speedMps: 0,
        sigmaM: 15,
        accuracyM: 30,
        climbM: 0,
      }),
    );
    expect(stats.distanceM).toBeLessThan(700);
    expect(stats.elevationGainM).toBeLessThan(200);
  });

  it("a real walk under canyon-grade noise reads close to the truth", () => {
    // 60 min at 1.2 m/s = 4.32 km, climbing 400 m, on 30 m fixes.
    // Before: 32.45 km and 9472 m.
    const stats = computeTrackStats(
      simulate({
        minutes: 60,
        speedMps: 1.2,
        sigmaM: 15,
        accuracyM: 30,
        climbM: 400,
      }),
    );
    expect(stats.distanceM).toBeGreaterThan(4000);
    expect(stats.distanceM).toBeLessThan(5000);
    expect(stats.elevationGainM).toBeGreaterThan(330);
    expect(stats.elevationGainM).toBeLessThan(520);
  });

  it("open-sky fixes stay accurate too (the gate is not just conservative)", () => {
    const stats = computeTrackStats(
      simulate({ minutes: 60, speedMps: 1.2, sigmaM: 4, accuracyM: 8, climbM: 400 }),
    );
    expect(stats.distanceM).toBeGreaterThan(4100);
    expect(stats.distanceM).toBeLessThan(4700);
    expect(stats.elevationGainM).toBeGreaterThan(360);
    expect(stats.elevationGainM).toBeLessThan(440);
  });
});

describe("rejectTrackFix drift and plausibility gates", () => {
  it("scales the movement gate to the fix's own accuracy radius", () => {
    const coarse = point({ timestampMs: 0, accuracyM: 30 });
    // 20 m of movement is inside a 30 m error circle — drift, not travel.
    const twentyMetres = 20 / M_PER_DEG_LAT;
    expect(
      rejectTrackFix(
        coarse,
        point({ lat: BASE_LAT + twentyMetres, accuracyM: 30, timestampMs: 60_000 }),
      ),
    ).toBe("too-close");
    // 40 m over the same minute clears it.
    expect(
      rejectTrackFix(
        coarse,
        point({
          lat: BASE_LAT + 40 / M_PER_DEG_LAT,
          accuracyM: 30,
          timestampMs: 60_000,
        }),
      ),
    ).toBeNull();
  });

  it("keeps the 5 m floor when the fix reports a tiny accuracy radius", () => {
    const sharp = point({ timestampMs: 0, accuracyM: 1 });
    expect(
      rejectTrackFix(
        sharp,
        point({ lat: BASE_LAT + 3 / M_PER_DEG_LAT, accuracyM: 1, timestampMs: 60_000 }),
      ),
    ).toBe("too-close");
  });

  it("rejects a teleport no canyoner can walk", () => {
    // 500 m in 10 s = 50 m/s — a re-acquired fix, not movement.
    expect(
      rejectTrackFix(
        point({ timestampMs: 0, accuracyM: 10 }),
        point({
          lat: BASE_LAT + 500 / M_PER_DEG_LAT,
          accuracyM: 10,
          timestampMs: 10_000,
        }),
      ),
    ).toBe("implausible");
  });

  it("allows a long gap to cover a long distance (pocket, lost signal)", () => {
    // Same 500 m, but an hour later — 0.14 m/s, entirely plausible.
    expect(
      rejectTrackFix(
        point({ timestampMs: 0, accuracyM: 10 }),
        point({
          lat: BASE_LAT + 500 / M_PER_DEG_LAT,
          accuracyM: 10,
          timestampMs: 3_600_000,
        }),
      ),
    ).toBeNull();
  });
});

describe("recordedDurationMs", () => {
  const startedAtMs = 1_700_000_000_000;

  it("counts wall-clock time past the last fix (the Finish-tap gap)", () => {
    expect(
      recordedDurationMs({
        startedAtMs,
        endedAtMs: startedAtMs + 60 * 60_000,
        pausedMs: 0,
        pausedAtMs: null,
        nowMs: startedAtMs + 99 * 60_000,
      }),
    ).toBe(60 * 60_000);
  });

  it("ticks while recording, so a stationary user's clock keeps moving", () => {
    expect(
      recordedDurationMs({
        startedAtMs,
        endedAtMs: null,
        pausedMs: 0,
        pausedAtMs: null,
        nowMs: startedAtMs + 90_000,
      }),
    ).toBe(90_000);
  });

  it("excludes completed and in-progress pauses", () => {
    expect(
      recordedDurationMs({
        startedAtMs,
        endedAtMs: null,
        pausedMs: 10 * 60_000,
        pausedAtMs: startedAtMs + 50 * 60_000,
        nowMs: startedAtMs + 60 * 60_000,
      }),
    ).toBe(40 * 60_000);
  });

  it("never goes negative when the device clock is wound back", () => {
    expect(
      recordedDurationMs({
        startedAtMs,
        endedAtMs: null,
        pausedMs: 0,
        pausedAtMs: null,
        nowMs: startedAtMs - 60_000,
      }),
    ).toBe(0);
  });
});
