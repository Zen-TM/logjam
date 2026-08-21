// The pure shape of a profile chart: the series builders, with no component
// and no React Native in sight.
//
// Split out of ProfileChart.tsx so they can be tested in plain node — the
// component cannot be imported into a test without a renderer, and the axis
// reconciliation below is exactly the kind of arithmetic that should have a
// check on it.
import type { ElevationProfile, SpeedProfile } from "@logjam/shared";

export type ProfilePoint = { x: number; value: number | null };

/**
 * What the chart draws. `min`/`max` are the SCALE, not the data's extremes —
 * a speed chart wants a floor of 0 (a stop must read as the bottom of the
 * chart) where an elevation chart scales between its own ends, because a
 * canyon between 700 and 840 m drawn from sea level is a flat bar.
 */
export type ProfileSeries = {
  points: ProfilePoint[];
  min: number | null;
  max: number | null;
};

/** A DEM or GPS height profile over DISTANCE, scaled between its own ends. */
export function elevationSeries(
  profile: ElevationProfile,
  /**
   * The distance the rest of the panel reports, when the caller has one.
   *
   * A DEM profile's own x axis is the length of the line it was sampled along,
   * and that line is built from RAW fix positions — while the headline
   * distance walks position-smoothed ones, because summing raw fix-to-fix hops
   * integrates the error circle as travel. On a real 3.4 km walk the two
   * disagreed by 14%: the chart ran to 4.0 km beside a stat card reading
   * 3.4 km, which reads as one of them being broken.
   *
   * The chart's shape is unaffected — this is a uniform scale, so every
   * feature stays at the same fraction along the track. It only stops the
   * axis contradicting the number printed above it.
   */
  alongDistanceM?: number,
): ProfileSeries {
  const lastM = profile.samples[profile.samples.length - 1]?.distanceM ?? 0;
  const scale =
    alongDistanceM != null && alongDistanceM > 0 && lastM > 0
      ? alongDistanceM / lastM
      : 1;
  return {
    points: profile.samples.map((sample) => ({
      x: sample.distanceM * scale,
      value: sample.elevationM,
    })),
    min: profile.minM,
    max: profile.maxM,
  };
}

/** A recorded speed series over TIME, scaled from a standstill up. */
export function speedSeries(profile: SpeedProfile): ProfileSeries {
  return {
    points: profile.samples.map((sample) => ({
      x: sample.atMs,
      value: sample.speedMps,
    })),
    min: 0,
    max: profile.maxMps,
  };
}
