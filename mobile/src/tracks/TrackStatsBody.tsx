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

  const stats: Stat[] = [];
  if (timed || elapsedMs != null) {
    stats.push({ label: "Time", value: formatDurationMs(durationMs) });
  }
  stats.push({ label: "Distance", value: formatDistanceM(detail.distanceM) });
  if (detail.movingMs != null && detail.stoppedMs != null) {
    stats.push({ label: "Moving", value: formatDurationMs(detail.movingMs) });
    stats.push({ label: "Stopped", value: formatDurationMs(detail.stoppedMs) });
  }
  stats.push({
    label: "Ascent",
    value: `↑ ${Math.round(detail.elevationGainM)} m`,
  });
  stats.push({
    label: "Descent",
    value: `↓ ${Math.round(detail.elevationLossM)} m`,
  });
  if (timed) {
    // Two speeds, because they answer different questions: the first is "how
    // long did the day take", the second is "how fast do we walk". A trip with
    // a long lunch has a very different pair, and one number hides that.
    stats.push({
      label: "Avg speed",
      value: formatSpeedMps(detail.averageSpeedMps),
    });
    stats.push({
      label: "Moving speed",
      value: formatSpeedMps(detail.movingSpeedMps),
    });
  }
  // ONE condition for every height on the panel, deliberately. A series with a
  // single altitude reading sets a min and a max — the same number twice — and
  // shipped a "High point 27 m / Low point 27 m" pair directly above the line
  // saying the track had no altitudes. A lone reading is not a height band and
  // cannot be drawn, so it says nothing at all.
  if (detail.elevation && detail.maxAltitudeM != null && detail.minAltitudeM != null) {
    stats.push({
      label: "High point",
      value: `${Math.round(detail.maxAltitudeM)} m`,
    });
    stats.push({
      label: "Low point",
      value: `${Math.round(detail.minAltitudeM)} m`,
    });
  }

  return (
    <View style={styles.body}>
      <StatGrid stats={stats} />

      {detail.elevation ? (
        <View style={styles.chartBlock}>
          <Text style={styles.chartLabel}>Elevation</Text>
          <ProfileChart
            series={elevationSeries(detail.elevation)}
            formatValue={(elevationM) => `${Math.round(elevationM)} m`}
            formatX={formatDistanceM}
            hint="Drag across for heights"
            accessibilityLabel="Elevation profile"
          />
        </View>
      ) : (
        <Text style={styles.pending}>
          {detail.maxAltitudeM == null
            ? "No altitudes in this track — distance and time are unaffected."
            : "Not enough altitude readings to chart — distance and time are unaffected."}
        </Text>
      )}

      {detail.speed ? (
        <View style={styles.chartBlock}>
          <Text style={styles.chartLabel}>Speed</Text>
          <ProfileChart
            series={speedSeries(detail.speed)}
            formatValue={formatSpeedMps}
            // The speed series runs on a CLOCK, not a tape measure — its x is
            // time into the recording (see SpeedSample).
            formatX={formatDurationMs}
            hint="Drag across for speeds"
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
