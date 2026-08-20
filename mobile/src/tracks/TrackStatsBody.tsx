// What a track IS, as numbers — the body shared by the live recording panel,
// a saved track's sheet and an imported file's.
//
// ONE definition of the stat list, because a recorded track reached from the
// map, the same track reached from Saved, and a GPX someone sent you are the
// same object seen three ways (DESIGN.md §7). A stat added here appears in all
// three or in none.
//
// What is absent is as deliberate as what is present: a series with no
// timestamps (an imported GPX without `<time>`) has no honest duration, pace
// or speed profile, so those cells are NOT RENDERED rather than rendered as
// zero. Distance and climb need no clock and are always there.
import { StyleSheet, Text, View } from "react-native";
import {
  formatDistanceM,
  formatDurationMs,
  formatSpeedMps,
  type ElevationProfile,
  type TrackDetail,
} from "@logjam/shared";

import { fontSize, fontWeight, spacing, theme } from "../theme";
import {
  ProfileChart,
  StatGrid,
  elevationSeries,
  speedSeries,
  type Stat,
} from "../ui";

export function TrackStatsBody({
  detail,
  loading,
  elapsedMs,
  emptyMessage,
  demProfile,
  demLoading,
}: {
  detail: TrackDetail | null;
  loading: boolean;
  /**
   * Wall-clock elapsed, for a LIVE recording. The point-derived duration stops
   * at the last accepted fix, so a party standing still would watch the clock
   * freeze and then jump (see `recordedDurationMs`). Omitted for a finished or
   * imported track, where the series is the whole story.
   */
  elapsedMs?: number;
  /** What to say when there is nothing to summarise — an empty recording and
   *  an unreadable file are not the same absence. */
  emptyMessage?: string;
  /**
   * Heights read from the DEM along the track, when anything could answer.
   *
   * PREFERRED over the recording's own GPS altitudes wherever it exists, for
   * every height on the panel — ascent, descent, the band, and the chart — so
   * the numbers and the picture come from one surface.
   *
   * Why the terrain beats the measurement here: gain and loss are a SUM OF
   * DIFFERENCES, so what matters is not absolute accuracy but per-sample noise.
   * A DEM is deterministic — read the same spot twice, get the same metre, and
   * a smooth spatial bias largely cancels in a difference. GPS altitude
   * re-reads the same spot with metres of independent error each time, and
   * summing thousands of those integrates noise into phantom climb (measured:
   * 99 m of "ascent" on a trip spanning 35 m). That is why GPS altitude needs a
   * 15 m hysteresis and a DEM only 5 — and why, on any trip with less relief
   * than the sensor's own noise, the GPS answer collapses toward zero while the
   * chart above it visibly rises and falls.
   *
   * Null offline outside a downloaded region, where the GPS altitudes are all
   * there is; the panel says which one it is showing rather than leaving the
   * reader to guess.
   */
  demProfile?: ElevationProfile | null;
  demLoading?: boolean;
}) {
  if (!detail) {
    return (
      <Text style={styles.pending}>
        {loading
          ? "Reading the track…"
          : (emptyMessage ?? "No points recorded yet.")}
      </Text>
    );
  }

  const durationMs = elapsedMs ?? detail.durationMs;
  const timed = detail.movingMs != null;
  // One source for every height on the panel.
  const elevation = demProfile ?? detail.elevation;
  const gainM = demProfile ? demProfile.gainM : detail.elevationGainM;
  const lossM = demProfile ? demProfile.lossM : detail.elevationLossM;
  const maxM = demProfile ? demProfile.maxM : detail.maxAltitudeM;
  const minM = demProfile ? demProfile.minM : detail.minAltitudeM;

  const stats: Stat[] = [];
  if (timed || elapsedMs != null) {
    stats.push({ label: "Time", value: formatDurationMs(durationMs) });
  }
  stats.push({ label: "Distance", value: formatDistanceM(detail.distanceM) });
  if (detail.movingMs != null && detail.stoppedMs != null) {
    stats.push({ label: "Moving", value: formatDurationMs(detail.movingMs) });
    stats.push({ label: "Stopped", value: formatDurationMs(detail.stoppedMs) });
  }
  stats.push({ label: "Ascent", value: `↑ ${Math.round(gainM)} m` });
  stats.push({ label: "Descent", value: `↓ ${Math.round(lossM)} m` });
  if (timed) {
    // Two speeds, because they answer different questions: the first is "how
    // long did the day take", the second is "how fast do we walk". A trip with
    // a long lunch has a very different pair, and one number hides that.
    stats.push({
      label: "Avg speed",
      value: formatSpeedMps(detail.averageSpeedMps),
    });
    stats.push({
      label: "Avg moving speed",
      value: formatSpeedMps(detail.movingSpeedMps),
    });
  }
  // ONE condition for every height on the panel, deliberately. A series with a
  // single altitude reading sets a min and a max — the same number twice — and
  // shipped a "High point 27 m / Low point 27 m" pair directly above the line
  // saying the track had no altitudes. A lone reading is not a height band and
  // cannot be drawn, so it says nothing at all.
  if (elevation && maxM != null && minM != null) {
    stats.push({ label: "High point", value: `${Math.round(maxM)} m` });
    stats.push({ label: "Low point", value: `${Math.round(minM)} m` });
  }

  return (
    <View style={styles.body}>
      <StatGrid stats={stats} />

      {elevation ? (
        <View style={styles.chartBlock}>
          {/* Names BOTH axes. "Elevation" alone left the horizontal one to be
              inferred, and a reader who assumes it is time reads the whole
              chart wrong — a long flat section is a plateau, not a rest. */}
          <Text style={styles.chartLabel}>Elevation vs distance</Text>
          <ProfileChart
            series={elevationSeries(elevation)}
            formatValue={(elevationM) => `${Math.round(elevationM)} m`}
            formatX={formatDistanceM}
            hint="Drag across for the height at a point along the track"
            accessibilityLabel="Elevation profile"
          />
          {/* Which surface these heights came from. Said out loud because the
              two can differ by a lot — a DEM cannot see inside a slot narrower
              than its ~19 m grid, and GPS altitude cannot see a hill smaller
              than its own noise. A number with no provenance gets trusted. */}
          <Text style={styles.pending}>
            {demProfile
              ? "Heights from terrain data"
              : demLoading
                ? "Heights from this phone's GPS — reading the terrain…"
                : "Heights from this phone's GPS — no terrain data for here"}
          </Text>
        </View>
      ) : (
        <Text style={styles.pending}>
          {demLoading
            ? "Reading the terrain…"
            : detail.maxAltitudeM == null
              ? "No heights for this track — distance and time are unaffected."
              : "Not enough height readings to chart — distance and time are unaffected."}
        </Text>
      )}

      {detail.speed ? (
        <View style={styles.chartBlock}>
          {/* And the speed chart's is TIME, not distance — the one place the
              two charts differ, and the reason each says which. */}
          <Text style={styles.chartLabel}>Speed vs time</Text>
          <ProfileChart
            series={speedSeries(detail.speed)}
            formatValue={formatSpeedMps}
            // The speed series runs on a CLOCK, not a tape measure — its x is
            // time into the recording (see SpeedSample).
            formatX={formatDurationMs}
            hint="Drag across for the speed at a time into the trip"
            accessibilityLabel="Speed profile"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing(1.5) },
  chartBlock: { gap: spacing(0.5) },
  chartLabel: {
    color: theme.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  pending: { color: theme.textMuted, fontSize: fontSize.sm },
});
