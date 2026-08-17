import { describe, expect, it } from "vitest";

import {
  HEADING_HYSTERESIS_DEG,
  HEADING_MAX_SLEW_DEG_PER_S,
  HEADING_SENSOR_MS,
  HEADING_SETTLED_DEG,
  HEADING_TICK_MS,
  POV_USER_SCREEN_FRACTION,
  createHeadingFilter,
  headingSettled,
  noteHeadingSample,
  normalizeBearing,
  povCameraCenter,
  resolveTrueHeading,
  shortestAngleDelta,
  stepHeadingFilter,
} from "./heading";

/**
 * Drive the whole pipeline the way the screen does: samples in at their own
 * irregular cadence, display out on the fixed tick. Returns the displayed
 * bearing at every tick, plus whether the ticker would still be running.
 */
function playHeading(
  samples: { atMs: number; deg: number }[],
  totalMs: number,
): { atMs: number; deg: number; ticking: boolean }[] {
  const filter = createHeadingFilter();
  const out: { atMs: number; deg: number; ticking: boolean }[] = [];
  let next = 0;
  let ticking = false;
  for (let now = 0; now <= totalMs; now += HEADING_TICK_MS) {
    while (next < samples.length && samples[next]!.atMs <= now) {
      if (noteHeadingSample(filter, samples[next]!.deg, now)) ticking = true;
      next += 1;
    }
    if (!ticking) {
      const held = filter.value;
      if (held != null) out.push({ atMs: now, deg: held, ticking });
      continue;
    }
    const deg = stepHeadingFilter(filter, now);
    if (headingSettled(filter)) ticking = false;
    if (deg != null) out.push({ atMs: now, deg, ticking });
  }
  return out;
}

/**
 * The sample stream a real turn produces off the rotation vector: one reading
 * every HEADING_SENSOR_MS, carrying the noise floor a gyro-fused orientation
 * actually has. Tests that feed a tidy noiseless stream measure a signal the
 * phone never sends.
 *
 * `SENSOR_NOISE_DEG` is deliberately deterministic rather than random — a
 * flaky smoothness test is worse than none — but it is the same size and
 * changes every sample, which is what the filters have to cope with.
 */
const SENSOR_NOISE_DEG = 0.3;
function spun(trueHeadingAt: (atMs: number) => number, totalMs: number) {
  const samples: { atMs: number; deg: number }[] = [];
  for (let atMs = 0; atMs <= totalMs; atMs += HEADING_SENSOR_MS) {
    const jitter = SENSOR_NOISE_DEG * Math.sin(atMs / 37) * Math.cos(atMs / 11);
    samples.push({ atMs, deg: trueHeadingAt(atMs) + jitter });
  }
  return samples;
}

/** Peak excursion from `about` over a window, in degrees. */
function wobble(
  played: { atMs: number; deg: number }[],
  about: number,
  fromMs: number,
  toMs: number,
): number {
  const window = played.filter((p) => p.atMs >= fromMs && p.atMs <= toMs);
  return Math.max(...window.map((p) => Math.abs(shortestAngleDelta(about, p.deg))));
}

describe("shortestAngleDelta", () => {
  it("takes the short way across north", () => {
    expect(shortestAngleDelta(350, 10)).toBe(20);
    expect(shortestAngleDelta(10, 350)).toBe(-20);
  });

  it("is zero for the same bearing", () => {
    expect(shortestAngleDelta(123, 123)).toBe(0);
  });
});

describe("noteHeadingSample", () => {
  it("takes the first sample as the target", () => {
    const filter = createHeadingFilter();
    expect(noteHeadingSample(filter, 42, 0)).toBe(true);
    expect(filter.target).toBe(42);
  });

  it("ignores the sensor's own wander on a still phone", () => {
    // THE NOISE FIX. A phone lying on a rock still reports a bearing that
    // creeps about by a fraction of a degree, thirty times a second. That must
    // not move the target at all — if it does, the ticker never stops and the
    // map rotates while nothing moves.
    const filter = createHeadingFilter();
    let moved = false;
    for (const { atMs, deg } of spun(() => 90, 3_000)) {
      moved = noteHeadingSample(filter, deg, atMs) || moved;
    }
    expect(filter.target).toBe(90);
    // Only the very first sample, which has nothing to compare against.
    expect(moved).toBe(true);
    expect(SENSOR_NOISE_DEG).toBeLessThan(HEADING_HYSTERESIS_DEG);
  });

  it("drags rather than gates, so a real turn has no staircase", () => {
    // The old ≥3° gate removed the wobble and kept the jump. A drag follower
    // keeps the target exactly HEADING_HYSTERESIS_DEG behind the sample, so
    // continuous input produces continuous output.
    const filter = createHeadingFilter();
    noteHeadingSample(filter, 0, 0);
    for (let i = 1; i <= 20; i += 1) noteHeadingSample(filter, i * 2.5, i * 100);
    expect(filter.target).toBeCloseTo(50 - HEADING_HYSTERESIS_DEG, 6);
  });
});

describe("the heading chase, end to end", () => {
  it("never crosses the wrong side of north", () => {
    // The bug this exists to prevent: a plain average of 358 and 2 is 180.
    const played = playHeading([{ atMs: 0, deg: 358 }, { atMs: 32, deg: 8 }], 400);
    for (const { deg } of played) expect(deg > 350 || deg < 10).toBe(true);
  });

  it("holds a still phone perfectly still, and stops ticking", () => {
    const played = playHeading(spun(() => 90, 5_000), 5_000);
    expect(wobble(played, 90, 200, 5_000)).toBe(0);
    expect(played[played.length - 1]!.ticking).toBe(false);
  });

  it("settles on a bearing it is given and then stops", () => {
    // Arrival matters twice over: the ticker has to be able to stop, and the
    // display must not park several degrees short of where the phone points.
    const played = playHeading([{ atMs: 0, deg: 0 }, { atMs: 100, deg: 90 }], 4_000);
    const last = played[played.length - 1]!;
    // Within the hysteresis, which is the whole of the standing error.
    expect(Math.abs(shortestAngleDelta(90, last.deg))).toBeLessThanOrEqual(
      HEADING_HYSTERESIS_DEG + HEADING_SETTLED_DEG,
    );
    expect(last.ticking).toBe(false);
  });

  it("keeps up with a real turn", () => {
    // THE RESPONSIVENESS HALF OF THE TRADE. A 90° turn of the body over 800 ms:
    // the display must be within a few degrees WHILE it is happening, not a
    // second later. Some standing lag is by design — the hysteresis alone is
    // 2.5° of it — so what this pins is that it is BOUNDED and does not grow.
    const turn = spun((t) => Math.min(t, 800) * (90 / 800), 800);
    const played = playHeading(turn, 800);
    for (const at of [300, 500, 700]) {
      const truth = Math.min(at, 800) * (90 / 800);
      const shown = played.find((p) => p.atMs >= at)!;
      expect(Math.abs(shortestAngleDelta(truth, shown.deg))).toBeLessThan(12);
    }
  });

  it("turns at a CONSTANT rate, which is the whole point", () => {
    // THE SMOOTHNESS TEST, and the one a position-chasing filter cannot pass.
    // The input is a 2° staircase; anything computing its output from the
    // current position error answers each step with its own little acceleration
    // and the map visibly stutters — worst at slow turn rates, where the steps
    // are furthest apart. Dead reckoning on a smoothed RATE flattens it.
    //
    // Measured as the spread of the per-tick angular velocity around its own
    // mean. The one-euro filter this replaced scored ±16.3°/s on the 25°/s case
    // below (±65 % of the mean); a plain exponential was worse again.
    for (const [rateDegPerS, tolerance] of [
      [8, 3],
      [25, 5],
      [60, 9],
    ] as const) {
      const played = playHeading(spun((t) => (t * rateDegPerS) / 1000, 6_000), 6_000);
      const settled = played.filter((p) => p.atMs > 1_500 && p.atMs < 5_000);
      const rates = settled
        .slice(1)
        .map(
          (p, i) =>
            (shortestAngleDelta(settled[i]!.deg, p.deg) * 1000) / HEADING_TICK_MS,
        );
      const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
      // Tracking the right speed at all, before asking how smoothly.
      expect(Math.abs(mean - rateDegPerS)).toBeLessThan(rateDegPerS * 0.1);
      const ripple = Math.max(...rates.map((r) => Math.abs(r - mean)));
      expect(ripple, `${rateDegPerS}°/s ripple`).toBeLessThan(tolerance);
    }
  });

  it("does not sail past a turn that stops between samples", () => {
    // The price of dead reckoning, and what HEADING_LEAD_DEG/MS bound. Without
    // the lead cap this overshot by tens of degrees and swung back.
    const played = playHeading(spun((t) => Math.min(t, 800) * 0.11, 5_000), 5_000);
    const after = played.filter((p) => p.atMs > 800);
    const overshoot = Math.max(...after.map((p) => shortestAngleDelta(88, p.deg)));
    expect(overshoot).toBeLessThan(7);
    // ...and it is back on the bearing, not parked past it.
    expect(Math.abs(shortestAngleDelta(88, after[after.length - 1]!.deg))).toBeLessThan(
      HEADING_HYSTERESIS_DEG + SENSOR_NOISE_DEG,
    );
  });

  it("never turns the display faster than the slew ceiling", () => {
    // A magnetometer spike is a 180° delta arriving in one sample, and it used
    // to be passed straight through as a snap.
    const played = playHeading([{ atMs: 0, deg: 0 }, { atMs: 32, deg: 180 }], 400);
    for (let i = 1; i < played.length; i += 1) {
      const perSecond =
        (Math.abs(shortestAngleDelta(played[i - 1]!.deg, played[i]!.deg)) * 1000) /
        HEADING_TICK_MS;
      expect(perSecond).toBeLessThanOrEqual(HEADING_MAX_SLEW_DEG_PER_S + 0.001);
    }
  });

  it("does not follow one bad sample", () => {
    // The old accelerometer+magnetometer source reported a genuinely backwards
    // azimuth at the start of a turn, because hand acceleration corrupted its
    // idea of down; the rotation vector does not, but a magnetic anomaly can
    // still produce an outlier. One sample of it must not reach the map: the
    // hysteresis absorbs most of it and the slow position term bleeds in the
    // rest over most of a second, by which time it has been contradicted.
    const samples = spun(() => 0, 2_000);
    samples[20] = { atMs: samples[20]!.atMs, deg: -25 };
    const played = playHeading(samples, 2_000);
    const worst = Math.min(...played.map((p) => shortestAngleDelta(0, p.deg)));
    // A fifth of it, for one tick. Not zero — nothing can tell an outlier from
    // the start of a real turn until the sample after it — but bounded, and
    // small enough not to read as movement.
    expect(worst).toBeGreaterThan(-5);
  });
});

describe("povCameraCenter", () => {
  it("looks ahead so the user sits below the middle of the screen", () => {
    // Due north at z15 on an 800 pt screen: the camera target moves north, and
    // by a quarter of the screen's worth of ground.
    const [lon, lat] = povCameraCenter([150.4033, -33.5603], 0, 15, 800);
    expect(lon).toBeCloseTo(150.4033, 9);
    expect(lat).toBeGreaterThan(-33.5603);
    const northMeters = (lat + 33.5603) * 111_195;
    expect(northMeters).toBeCloseTo((POV_USER_SCREEN_FRACTION - 0.5) * 800 * 2.0, -1);
  });

  it("looks along the heading, not along north", () => {
    const east = povCameraCenter([150.4033, -33.5603], 90, 15, 800);
    expect(east[0]).toBeGreaterThan(150.4033);
    expect(east[1]).toBeCloseTo(-33.5603, 9);
  });

  it("is a no-op for a zero-height map rather than a NaN camera stop", () => {
    expect(povCameraCenter([150, -33], 45, 15, 0)).toEqual([150, -33]);
  });
});

describe("resolveTrueHeading", () => {
  it("passes a real true heading through untouched", () => {
    expect(resolveTrueHeading({ trueHeading: 42, magHeading: 30 })).toBe(42);
    expect(resolveTrueHeading({ trueHeading: 0, magHeading: 350 })).toBe(0);
  });

  it("corrects magnetic for NSW declination when true is unavailable", () => {
    // Facing true north, the magnetometer reads 347.5° in the Blue Mountains.
    expect(resolveTrueHeading({ trueHeading: -1, magHeading: 347.5 })).toBeCloseTo(
      0,
      6,
    );
    expect(resolveTrueHeading({ trueHeading: -1, magHeading: 100 })).toBeCloseTo(
      112.5,
      6,
    );
  });

  it("wraps past 360 rather than returning an out-of-range bearing", () => {
    expect(resolveTrueHeading({ trueHeading: -1, magHeading: 355 })).toBeCloseTo(
      7.5,
      6,
    );
  });

  it("returns null when the device has no usable heading at all", () => {
    expect(resolveTrueHeading({ trueHeading: -1, magHeading: -1 })).toBeNull();
  });
});

describe("normalizeBearing", () => {
  it("folds any bearing into 0..360", () => {
    expect(normalizeBearing(0)).toBe(0);
    expect(normalizeBearing(370)).toBe(10);
    expect(normalizeBearing(-10)).toBe(350);
    expect(normalizeBearing(-370)).toBe(350);
  });

  it("reads a non-finite bearing as north rather than poisoning a camera stop", () => {
    expect(normalizeBearing(NaN)).toBe(0);
    expect(normalizeBearing(Infinity)).toBe(0);
  });
});
