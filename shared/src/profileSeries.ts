// The pure shape of a profile chart: the series builders, with no component
// and no React Native in sight.
//
// Here rather than in either client because both draw the same two charts of a
// track (Logjam GPS's stats panel, Logjam Web's way page): what each axis
// means, which heights are charted and the words around them are decided once
// and each client only draws.
import { MAP_MEASURE } from "./contracts/mapMeasure.js";
import {
  climbSourceOf,
  GPS_CLIMB_SOURCE,
  NSW_5M,
  SHARPENED_CLIMB_SOURCE,
  TERRARIUM,
} from "./demSources.js";
import type { ElevationProfile } from "./elevation.js";
import { PAIRED_STAT_LABELS } from "./statPairs.js";
import {
  formatDistanceM,
  formatDurationMs,
  formatSpeedMps,
  speedClockMs,
  type SpeedProfile,
  type TrackDetail,
} from "./trackStats.js";

export type ProfilePoint = { x: number; value: number | null };

/**
 * What the chart draws. `min`/`max` are the SCALE, not the data's extremes —
 * a speed chart wants a floor of 0 (a stop must read as the bottom of the
 * chart) where an elevation chart scales between its own ends, because a
 * place between 700 and 840 m drawn from sea level is a flat bar.
 */
export type ProfileSeries = {
  points: ProfilePoint[];
  min: number | null;
  max: number | null;
};

/** What a chart scales a series' values over: its own range, however small,
 *  so a river that moved 9 cm in a week still fills the chart. A series of one
 *  value has no range, and a chart must not divide by it. */
export function profileSpan(min: number, max: number): number {
  return max - min || 1;
}

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

/** A height as the charts and their readouts print it. */
export function formatElevationM(elevationM: number): string {
  return `${Math.round(elevationM)} m`;
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

/**
 * Reads a wall-clock instant as a time of day in the device's time zone, for
 * a series that starts at `startMs` and ends at `endMs`. A series that runs
 * into another day says which day each time is on, because "12:10 am" on an
 * overnight recording is otherwise before its own start.
 */
export function timeOfDayFormatter(
  startMs: number,
  endMs: number,
): (ms: number) => string {
  const overnight =
    new Date(startMs).toDateString() !== new Date(endMs).toDateString();
  return (ms) =>
    new Date(ms).toLocaleString(undefined, {
      weekday: overnight ? "short" : undefined,
      hour: "numeric",
      minute: "2-digit",
    });
}

/** Reads a speed sample's `atMs` as the time of day it was. */
export function speedTimeFormatter(
  speed: SpeedProfile,
): (atMs: number) => string {
  const format = timeOfDayFormatter(
    speedClockMs(speed, 0),
    speedClockMs(speed, speed.samples[speed.samples.length - 1]!.atMs),
  );
  return (atMs) => format(speedClockMs(speed, atMs));
}

/**
 * The words around a track's two charts. Each title names BOTH axes: the
 * elevation chart runs on distance and the speed chart on time, and a reader
 * who assumes otherwise reads a plateau as a rest.
 */
export const TRACK_PROFILE_COPY = {
  reading: "Reading the track…",
  elevationTitle: "Elevation vs distance",
  elevationLabel: "Elevation profile",
  speedTitle: "Speed vs time",
  speedLabel: "Speed profile",
} as const;

/**
 * What a reader is told a height came from, by `CLIMB_SOURCES` id. One per
 * id: "names every source a climb can be stored from" in
 * profileSeries.test.ts.
 */
const HEIGHT_SOURCE_NAMES: Record<string, string> = {
  [SHARPENED_CLIMB_SOURCE]: "LiDAR terrain data",
  [NSW_5M.id]: "NSW 5 m terrain data",
  [TERRARIUM.id]: "30 m terrain data",
  [GPS_CLIMB_SOURCE]: "GPS heights",
};
/** A source this build does not know was written by a newer one. */
const UNNAMED_SOURCE = "terrain data";

/** The name of the one climb source a profile was read from, if just one. */
function heightSourceName(sourceIds: readonly string[] | undefined): string {
  const sources = new Set(sourceIds?.map(climbSourceOf));
  return sources.size === 1
    ? (HEIGHT_SOURCE_NAMES[[...sources][0]!] ?? UNNAMED_SOURCE)
    : UNNAMED_SOURCE;
}

/**
 * The line under a finished recording's stored Ascent and Descent, saying
 * which source they were read from (nothing stored beside them means GPS).
 * They are stored and the chart is read live, so the two can come from
 * different sources; each says its own, in the same words.
 */
export function storedClimbCaption(source: string | null | undefined): string {
  return `Ascent and descent from ${HEIGHT_SOURCE_NAMES[source ?? GPS_CLIMB_SOURCE] ?? UNNAMED_SOURCE}`;
}

/**
 * Which heights a track's panel shows, and the line that says where they came
 * from.
 *
 * The DEM is preferred over the track's own GPS altitudes, but only when it
 * answered EVERY sample: one uncovered sample would draw a hole the reader
 * cannot tell from the terrain, so a partial DEM falls back to GPS for the
 * whole panel rather than mixing two surfaces. `dem` is that complete profile
 * or null; `elevation` is what to chart, null when neither source can draw a
 * line, and `note` then says why.
 */
export function trackHeights(
  detail: TrackDetail,
  demProfile: ElevationProfile | null | undefined,
  demLoading: boolean,
): {
  dem: ElevationProfile | null;
  elevation: ElevationProfile | null;
  note: string;
} {
  const complete =
    demProfile != null &&
    demProfile.samples.every((sample) => sample.elevationM != null);
  const dem = complete ? demProfile : null;
  const elevation = dem ?? detail.elevation;
  const note = !elevation
    ? demLoading
      ? MAP_MEASURE.copy.readingTerrain
      : detail.maxAltitudeM == null
        ? "No heights for this track"
        : "Not enough height readings to chart"
    : dem?.filledFromGps
      ? "Terrain data covers part of this track — the rest is from GPS"
      : dem
        ? // Named only when ONE source answered, counting every sharpened
          // area as one (`lidar`), as a stored climb is: a line read from two
          // has no single name, and the credit beside it lists both.
          `Heights from ${heightSourceName(dem.demSourceIds)}`
        : demProfile
          ? "Terrain data incomplete — heights from GPS"
          : demLoading
            ? "Heights from GPS — loading terrain…"
            : "Heights from GPS — no terrain data here";
  return { dem, elevation, note };
}

/**
 * A track's figures, in the order both clients list them.
 *
 * What is absent is as deliberate as what is present: a series with no
 * timestamps has no honest duration or pace, so those rows are NOT LISTED
 * rather than listed as zero. Distance and climb need no clock and are always
 * there.
 *
 * Every height comes from the one surface `trackHeights` chose, so the
 * numbers and the chart agree.
 */
export function trackStatRows(
  detail: TrackDetail,
  heights: Pick<ReturnType<typeof trackHeights>, "dem" | "elevation">,
  options: {
    /** Wall-clock elapsed, for a LIVE recording: see `recordedDurationMs`. */
    elapsedMs?: number;
    /**
     * A FINISHED recording's stored climb and descent. Listed instead of this
     * reading, so the track's page, the Saved list, the Stats totals and both
     * clients give one figure for one track. Omitted for a live recording and
     * an import, which have nothing stored.
     */
    storedClimb?: { gainM: number; lossM: number } | null;
  } = {},
): { label: string; value: string }[] {
  const { dem, elevation } = heights;
  const { elapsedMs, storedClimb } = options;
  const timed = detail.movingMs != null;
  const gainM = storedClimb?.gainM ?? (dem ? dem.gainM : detail.elevationGainM);
  const lossM = storedClimb?.lossM ?? (dem ? dem.lossM : detail.elevationLossM);
  const maxM = dem ? dem.maxM : detail.maxAltitudeM;
  const minM = dem ? dem.minM : detail.minAltitudeM;
  const L = PAIRED_STAT_LABELS;

  const rows: { label: string; value: string }[] = [];
  if (timed || elapsedMs != null) {
    rows.push({
      label: "Time",
      value: formatDurationMs(elapsedMs ?? detail.durationMs),
    });
  }
  rows.push({ label: "Distance", value: formatDistanceM(detail.distanceM) });
  if (detail.movingMs != null && detail.stoppedMs != null) {
    rows.push({ label: L.moving, value: formatDurationMs(detail.movingMs) });
    rows.push({ label: L.stopped, value: formatDurationMs(detail.stoppedMs) });
  }
  rows.push({ label: L.ascent, value: `↑ ${Math.round(gainM)} m` });
  rows.push({ label: L.descent, value: `↓ ${Math.round(lossM)} m` });
  if (timed) {
    // Two speeds, because they answer different questions: the first is "how
    // long did the day take", the second is "how fast do we walk". A trip with
    // a long lunch has a very different pair, and one number hides that.
    rows.push({
      label: L.avgSpeed,
      value: formatSpeedMps(detail.averageSpeedMps),
    });
    rows.push({
      label: L.avgMovingSpeed,
      value: formatSpeedMps(detail.movingSpeedMps),
    });
  }
  // ONE condition for every height, deliberately. A series with a single
  // altitude reading sets a min and a max — the same number twice — which is
  // not a height band and cannot be drawn, so it says nothing at all.
  if (elevation && maxM != null && minM != null) {
    rows.push({ label: L.highPoint, value: formatElevationM(maxM) });
    rows.push({ label: L.lowPoint, value: formatElevationM(minM) });
  }
  return rows;
}

/**
 * Whether two series draw the same picture.
 *
 * A live recording rebuilds its series on every 1 Hz tick of the clock — new
 * arrays, same numbers whenever no fix landed in between (the elevation
 * profile never moves with the clock) — and the chart is hundreds of Views, so
 * the tick must be able to tell "new object" from "new data".
 */
export function sameSeries(a: ProfileSeries, b: ProfileSeries): boolean {
  if (a === b) return true;
  if (a.min !== b.min || a.max !== b.max) return false;
  if (a.points.length !== b.points.length) return false;
  return a.points.every((point, i) => {
    const other = b.points[i]!;
    return point.x === other.x && point.value === other.value;
  });
}
