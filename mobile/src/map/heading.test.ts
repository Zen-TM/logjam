import { beforeEach, describe, expect, it } from "vitest";

import {
  HEADING_HYSTERESIS_DEG,
  HEADING_MAX_SLEW_DEG_PER_S,
  HEADING_SETTLED_DEG,
  HEADING_TICK_MS,
  POV_USER_SCREEN_FRACTION,
  EMPTY_FIELD_WINDOW,
  NO_COMPASS_CALIBRATION,
  NSW_FIELD_STRENGTH_UT,
  addFieldSample,
  compassDiagnostics,
  compassProbeIsUrgent,
  createHeadingFilter,
  currentDeclinationDeg,
  declinationNeedsRefresh,
  deviceSampleTimeMs,
  fieldSpread,
  fieldStrength,
  fieldStrengthUt,
  foldCompassProbe,
  headingSettled,
  isDeclinationLearned,
  learnDeclination,
  magneticInterference,
  normalizeBearing,
  noteDeclinationFix,
  noteHeadingSample,
  povCameraCenter,
  resetDeclination,
  resolveTrueHeading,
  shortestAngleDelta,
  stepHeadingFilter,
  type FieldWindow,
} from "./heading";
import { displayHeading } from "./compassTape";

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
 * BOTH NUMBERS ARE MEASURED, not guessed (Pixel 9, `HDGPROBE` log, 35 s at
 * rest, 2026-08-17): distinct readings arrive every 133 ms median, and a phone
 * lying still wanders 0.053° peak-to-peak. Note that the cadence is NOT
 * `HEADING_SENSOR_MS` — that is only how often we ask to be handed the latest
 * value, and modelling the stream at that rate flatters every filter in here.
 *
 * The noise is deliberately deterministic rather than random — a flaky
 * smoothness test is worse than none — but it is the right size and it moves
 * every sample, which is what the filters have to cope with.
 */
const SENSOR_GAP_MS = 133;
const SENSOR_NOISE_DEG = 0.053 / 2;
function spun(trueHeadingAt: (atMs: number) => number, totalMs: number) {
  const samples: { atMs: number; deg: number }[] = [];
  for (let atMs = 0; atMs <= totalMs; atMs += SENSOR_GAP_MS) {
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
    const played = playHeading([{ atMs: 0, deg: 0 }, { atMs: 100, deg: 90 }], 8_000);
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
      expect(Math.abs(shortestAngleDelta(truth, shown.deg))).toBeLessThan(25);
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
    // below (±65 % of the mean); a plain exponential was worse again; and the
    // rate-tracking version scored the same ±99 % for as long as
    // HEADING_RATE_MAX_GAP_MS sat below the sensor's real cadence and quietly
    // rejected every rate measurement. Tolerances are ~1.3× what the constants
    // currently achieve, so a regression of that kind fails here.
    for (const [rateDegPerS, tolerance] of [
      [8, 2],
      [25, 5],
      [60, 11],
    ] as const) {
      const played = playHeading(spun((t) => (t * rateDegPerS) / 1000, 8_000), 8_000);
      const settled = played.filter((p) => p.atMs > 1_500 && p.atMs < 6_000);
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
    const played = playHeading(spun((t) => Math.min(t, 800) * 0.11, 8_000), 8_000);
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
    const samples = spun(() => 0, 4_000);
    samples[10] = { atMs: samples[10]!.atMs, deg: -25 };
    const played = playHeading(samples, 4_000);
    const worst = Math.min(...played.map((p) => shortestAngleDelta(0, p.deg)));
    // A fifth of it, for one tick. Not zero — nothing can tell an outlier from
    // the start of a real turn until the sample after it — but bounded, and
    // small enough not to read as movement.
    expect(worst).toBeGreaterThan(-5);
  });
});

describe("overshoot off a fast flick", () => {
  /**
   * Peak degrees past the bearing the phone actually stopped on, and how long
   * it takes to come back within 3° of it.
   */
  function flick(rateDegPerS: number, durationMs: number) {
    const settledAt = (durationMs * rateDegPerS) / 1000;
    const played = playHeading(
      spun((t) => (Math.min(t, durationMs) * rateDegPerS) / 1000, 5_000),
      5_000,
    ).filter((p) => p.atMs > durationMs);
    const peak = Math.max(...played.map((p) => shortestAngleDelta(settledAt, p.deg)));
    const recovered = played.find(
      (p) => Math.abs(shortestAngleDelta(settledAt, p.deg)) < 3,
    );
    return { peak, recoveredMs: (recovered?.atMs ?? Infinity) - durationMs };
  }

  it("stays within a few degrees however hard the phone is turned", () => {
    // THE BUG HEADING_LEAD_MAX_DEG EXISTS FOR. The lead cap is `base + rate ×
    // HEADING_LEAD_MS`, which had no ceiling — so the bound on overshoot scaled
    // with the rate it was bounding, and a hard wrist flick (~700-1000°/s) ran
    // the map tens of degrees past the bearing the phone had stopped on and
    // then crawled back over a second. It was signed off on a 110°/s turn,
    // where the same formula gives 5°.
    for (const [rate, duration] of [
      [200, 600],
      [400, 450],
      [700, 350],
    ] as const) {
      const { peak, recoveredMs } = flick(rate, duration);
      expect(peak, `${rate}°/s overshoot`).toBeLessThan(9);
      // The tail from the peak back to dead-on is HEADING_CATCHUP_TAU_MS by
      // design and is deliberately slow; what matters is that it starts from a
      // few degrees rather than from tens.
      expect(recoveredMs, `${rate}°/s recovery`).toBeLessThan(900);
    }
  });

  it("never dead-reckons faster than the display may turn", () => {
    // The rate estimate feeds the lead cap, so an unclamped one is a second
    // route to the same overshoot.
    const filter = createHeadingFilter();
    let at = 0;
    for (let i = 0; i < 20; i += 1) {
      // 1500°/s: faster than any wrist, and faster than the display's ceiling.
      noteHeadingSample(filter, (at * 1500) / 1000, at);
      at += 100;
    }
    expect(Math.abs(filter.rateDegPerS)).toBeLessThanOrEqual(
      HEADING_MAX_SLEW_DEG_PER_S,
    );
  });
});

describe("the ticker's idle guarantee", () => {
  /**
   * Run the pipeline exactly as the screen does and count how much of the time
   * the ticker would be RUNNING. That is the battery number: while it ticks,
   * the screen re-renders two components ~31 times a second and course-up
   * writes a camera stop per tick.
   */
  function dutyCycle(noiseDeg: number, totalMs = 20_000): number {
    const filter = createHeadingFilter();
    let ticking = false;
    let ticks = 0;
    let frames = 0;
    let nextSample = 0;
    for (let now = 0; now <= totalMs; now += HEADING_TICK_MS) {
      while (nextSample <= now) {
        const wobble = noiseDeg * Math.sin(nextSample / 37) * Math.cos(nextSample / 11);
        if (noteHeadingSample(filter, 90 + wobble, nextSample)) ticking = true;
        nextSample += SENSOR_GAP_MS;
      }
      frames += 1;
      if (!ticking) continue;
      ticks += 1;
      stepHeadingFilter(filter, now);
      if (headingSettled(filter)) ticking = false;
    }
    return ticks / frames;
  }

  it("stops ticking below the hysteresis, and only below it", () => {
    // THE WHOLE BATTERY ARGUMENT, and it is a cliff rather than a slope. The
    // target is dragged to sit HEADING_HYSTERESIS_DEG behind the sample, so
    // noise wider than that band moves it 1:1; the display cannot catch a
    // target oscillating at sample rate, so `headingSettled` never fires and
    // the ticker runs for as long as the map is open. Measured either side:
    //   ±1.0° -> 0.2 %      ±1.3° -> 23 %      ±2.0° -> 82 %
    // A Pixel 9 lying still wanders 0.053° peak-to-peak, which is where
    // SENSOR_NOISE_DEG comes from — twenty times inside the band.
    expect(dutyCycle(SENSOR_NOISE_DEG)).toBeLessThan(0.01);
    expect(dutyCycle(HEADING_HYSTERESIS_DEG * 0.9)).toBeLessThan(0.01);
    // ...and the other side, so nobody "simplifies" the hysteresis away and
    // leaves this test passing.
    expect(dutyCycle(HEADING_HYSTERESIS_DEG * 2)).toBeGreaterThan(0.5);
  });
});

describe("declination", () => {
  it("derives the real value by differencing the two norths", () => {
    // expo-location builds trueHeading as magHeading + GeomagneticField
    // .declination (LocationModule.kt:603-607), so the difference IS Android's
    // own value and we need no model of our own.
    resetDeclination();
    expect(learnDeclination({ magHeading: 100, trueHeading: 112.4 })).toBe(true);
    expect(resolveTrueHeading({ trueHeading: -1, magHeading: 0 })).toBeCloseTo(12.4, 6);
  });

  it("keeps the NSW fallback when there is no fix to derive one from", () => {
    resetDeclination();
    // trueHeading is -1 whenever expo-location has no fix.
    expect(learnDeclination({ magHeading: 100, trueHeading: -1 })).toBe(false);
    expect(resolveTrueHeading({ trueHeading: -1, magHeading: 347.5 })).toBeCloseTo(0, 6);
  });

  it("refreshes on travel, not on a clock", () => {
    resetDeclination();
    expect(declinationNeedsRefresh(-33.56, 150.4)).toBe(true);
    noteDeclinationFix(-33.56, 150.4);
    // Same valley all week: no refresh, however long the app stays open.
    expect(declinationNeedsRefresh(-33.57, 150.41)).toBe(false);
    // A drive down the coast: refresh.
    expect(declinationNeedsRefresh(-34.6, 150.4)).toBe(true);
  });
});

describe("declination west of the agonic line", () => {
  it("reads a negative true heading as real, not as the no-fix sentinel", () => {
    // `calcTrueNorth` is `(magNorth + declination) % 360` in Kotlin, whose `%`
    // keeps the sign, so anywhere declination is WESTERN the real answer comes
    // back negative. A `>= 0` test reads that as "no fix" and pins the app to
    // the NSW constant — silently wrong by up to the local declination, which
    // is the one number this whole path exists to get right.
    resetDeclination();
    // Christchurch NZ: about 23° EAST... use a western case, Vancouver ~15°E of
    // grid but the sign that matters here is the arithmetic one: mag 10, true
    // -5 means 15° WEST.
    expect(learnDeclination({ magHeading: 10, trueHeading: -5 })).toBe(true);
    expect(resolveTrueHeading({ trueHeading: -1, magHeading: 0 })).toBeCloseTo(345, 6);
  });

  it("still treats the exact sentinel as no fix", () => {
    resetDeclination();
    expect(learnDeclination({ magHeading: 10, trueHeading: -1 })).toBe(false);
  });

  it("normalises a negative true heading rather than passing it through", () => {
    // It reaches the camera as a bearing; -5 would be a stop MapLibre reads as
    // 355 anyway, but the arrow and the tape read the same number.
    expect(resolveTrueHeading({ trueHeading: -5, magHeading: 10 })).toBeCloseTo(355, 6);
  });
});

describe("the tape's magnetic mode", () => {
  it("subtracts exactly what the forward path added", () => {
    // Two sources for one constant: the tape subtracted the NSW literal while
    // resolveTrueHeading added the LEARNED value, so the labels drifted from
    // the map by `learned - 12.5` once a fix supplied one.
    resetDeclination();
    learnDeclination({ magHeading: 100, trueHeading: 118 });
    const trueBearing = resolveTrueHeading({ trueHeading: -1, magHeading: 40 });
    expect(trueBearing).toBeCloseTo(58, 6);
    // What a baseplate compass would read at that true bearing: back to 40.
    expect(displayHeading(trueBearing!, "magnetic")).toBeCloseTo(40, 6);
  });
});

describe("deviceSampleTimeMs", () => {
  it("puts the sensor's monotonic clock into the Date.now() domain", () => {
    // The rate estimate divides by these gaps, so they have to be the sensor's
    // own spacing and not our dispatch interval.
    const filter = createHeadingFilter();
    const bootSeconds = 4_321.5;
    const first = deviceSampleTimeMs(filter, bootSeconds, 1_700_000_000_000);
    expect(first).toBe(1_700_000_000_000);
    // A reading 133 ms later by the sensor's clock, handed over 40 ms late.
    const second = deviceSampleTimeMs(filter, bootSeconds + 0.133, 1_700_000_000_173);
    expect(second - first).toBeCloseTo(133, 6);
  });

  it("falls back to arrival time when a platform omits the timestamp", () => {
    const filter = createHeadingFilter();
    expect(deviceSampleTimeMs(filter, undefined, 12_345)).toBe(12_345);
  });
});

describe("the compass calibration verdict", () => {
  const bad = 0; // SENSOR_STATUS_ACCURACY_UNRELIABLE
  const good = 3; // ...HIGH

  function fold(readings: (number | null)[]) {
    return readings.reduce(foldCompassProbe, NO_COMPASS_CALIBRATION);
  }

  it("warns where the system compass app does — at LOW", () => {
    // Agreeing with the phone's own compass app is the requirement: after a
    // reboot it said LOW and asked for a calibration while this said nothing.
    // The reading IS contaminated (expo-location's `onAccuracyChanged` does not
    // filter by sensor, and the same listener covers the accelerometer), which
    // is why confirmation over consecutive probes carries the noise rejection
    // rather than the threshold doing it.
    expect(fold([3, 3, 3]).warning).toBe(false);
    expect(fold([2, 2, 2]).warning).toBe(false);
    expect(fold([1, 1, 1]).warning).toBe(true);
    expect(fold([bad, bad, bad]).warning).toBe(true);
  });

  it("needs confirmation to appear and none to clear", () => {
    // THE ASYMMETRY IS DELIBERATE. Slow to appear costs nothing — the compass
    // was already wrong while we made our mind up. Slow to CLEAR is the bug:
    // the user has just waved the phone in a figure of eight and is staring at
    // the banner wondering whether it worked.
    expect(fold([bad, bad]).warning).toBe(false);
    expect(fold([bad, bad, bad]).warning).toBe(true);
    expect(fold([bad, bad, bad, good]).warning).toBe(false);
    // ...and one good reading resets the count, so it is CONSECUTIVE bad
    // probes, not bad probes in total.
    expect(fold([bad, bad, good, bad, bad]).warning).toBe(false);
  });

  it("treats no reading as no information, in both directions", () => {
    // A phone lying still emits no heading events at all (2 degree gate), so
    // silence is the normal state of a phone on a rock. It must not raise a
    // warning...
    expect(fold([null, null, null, null]).warning).toBe(false);
    // ...and it must not clear one either, or a phone set down mid-fault would
    // quietly drop the banner while still pointing the wrong way.
    expect(fold([bad, bad, bad, null, null]).warning).toBe(true);
  });

  it("probes urgently while a warning is up or being confirmed", () => {
    expect(compassProbeIsUrgent(NO_COMPASS_CALIBRATION)).toBe(false);
    expect(compassProbeIsUrgent(fold([bad]))).toBe(true);
    expect(compassProbeIsUrgent(fold([bad, bad, bad]))).toBe(true);
    expect(compassProbeIsUrgent(fold([bad, bad, bad, good]))).toBe(false);
  });
});

describe("the magnetic environment", () => {
  const undisturbed = (n = 6) =>
    Array.from({ length: n }).reduce<FieldWindow>(
      (w) => addFieldSample(w, NSW_FIELD_STRENGTH_UT),
      EMPTY_FIELD_WINDOW,
    );

  it("measures a field's strength regardless of which way it points", () => {
    // The whole basis of this check: direction has no known correct answer and
    // magnitude does.
    expect(fieldStrengthUt({ x: NSW_FIELD_STRENGTH_UT, y: 0, z: 0 })).toBeCloseTo(57, 6);
    expect(fieldStrengthUt({ x: 0, y: 0, z: -NSW_FIELD_STRENGTH_UT })).toBeCloseTo(57, 6);
    expect(fieldStrengthUt({ x: 3, y: 4, z: 0 })).toBeCloseTo(5, 6);
  });

  it("passes an undisturbed field", () => {
    expect(magneticInterference(undisturbed())).toBe(false);
    // Real readings wobble; the tolerance has to cover that.
    let window = EMPTY_FIELD_WINDOW;
    for (const ut of [55, 57, 58, 56, 57]) window = addFieldSample(window, ut);
    expect(magneticInterference(window)).toBe(false);
  });

  it("catches a magnet by its strength", () => {
    // THE CASE THE ACCURACY FLAG CANNOT SEE. A magnet against the phone is
    // hard iron: it moves the calibration sphere's centre rather than spoiling
    // its fit, so Android goes on reporting HIGH while the bearing is wrong.
    let window = EMPTY_FIELD_WINDOW;
    for (const ut of [340, 355, 349]) window = addFieldSample(window, ut);
    expect(magneticInterference(window)).toBe(true);
  });

  it("catches a disturbance whose strength happens to look plausible", () => {
    // Second test, and the reason the window keeps a min and a max rather than
    // an average: a correctly-calibrated compass reads the SAME strength
    // whichever way the phone points, so a strength that swings while the user
    // turns is a fault even when every individual reading is believable.
    let window = EMPTY_FIELD_WINDOW;
    for (const ut of [45, 70, 48, 68]) window = addFieldSample(window, ut);
    expect(fieldStrength(window)).toBeCloseTo(57.5, 6);
    expect(fieldSpread(window)).toBeCloseTo(25, 6);
    expect(magneticInterference(window)).toBe(true);
  });

  it("says nothing about a window that read nothing", () => {
    expect(fieldStrength(EMPTY_FIELD_WINDOW)).toBeNull();
    expect(fieldSpread(EMPTY_FIELD_WINDOW)).toBe(0);
    expect(magneticInterference(EMPTY_FIELD_WINDOW)).toBe(false);
  });

  it("reports what it saw in words a person can act on", () => {
    expect(compassDiagnostics(3, undisturbed())).toContain("accuracy high");
    expect(compassDiagnostics(3, undisturbed())).toContain("57 µT");
    expect(compassDiagnostics(0, EMPTY_FIELD_WINDOW)).toContain("unreliable");
    expect(compassDiagnostics(null, EMPTY_FIELD_WINDOW)).toContain("unknown");
    expect(compassDiagnostics(null, EMPTY_FIELD_WINDOW)).toContain("not read");
  });
});

describe("isDeclinationLearned", () => {
  it("distinguishes Android's real value from the NSW fallback", () => {
    // Otherwise indistinguishable from outside, which is what the settings
    // hint exists to fix.
    resetDeclination();
    expect(isDeclinationLearned()).toBe(false);
    learnDeclination({ magHeading: 100, trueHeading: 112.4 });
    // Learning the value is not the same as knowing where it applies — the
    // position is what lets it be re-derived after travel.
    noteDeclinationFix(-33.56, 150.4);
    expect(isDeclinationLearned()).toBe(true);
    expect(currentDeclinationDeg()).toBeCloseTo(12.4, 6);
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
  // The declination is module state, deliberately — it describes where the user
  // is, not any one screen. So it survives between tests unless reset.
  beforeEach(resetDeclination);

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
