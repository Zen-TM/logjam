// What a track IS, as numbers — the body shared by the live recording panel,
// a saved track's sheet and an imported file's.
//
// ONE definition of the stat list, because a recorded track reached from the
// map, the same track reached from Saved, and a GPX someone sent you are the
// same object seen three ways (DESIGN.md). A stat added here appears in all
// three or in none.
//
// What is absent is as deliberate as what is present: a series with no
// timestamps (an imported GPX without `<time>`) has no honest duration, pace
// or speed profile, so those cells are NOT RENDERED rather than rendered as
// zero. Distance and climb need no clock and are always there.
import { Text, View } from "react-native";
import {
  elevationSeries,
  formatDistanceM,
  formatSpeedMps,
  pairedStatLayout,
  speedSeries,
  speedTimeFormatter,
  storedClimbCaption,
  TRACK_PROFILE_COPY,
  trackHeights,
  trackStatRows,
  type ElevationProfile,
  type TrackDetail,
} from "@logjam/shared";

import { fontSize, spacing, makeStyles } from "../theme";
import { ProfileChart, StatGrid, type Stat } from "../ui";

export function TrackStatsBody({
  detail,
  loading,
  elapsedMs,
  emptyMessage,
  demProfile,
  demLoading,
  storedClimb,
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
  /**
   * A FINISHED recording's stored climb and descent (`tracks/trackClimb.ts`).
   * Shown instead of this panel's own reading, so the sheet, the Saved list,
   * the Stats totals and Logjam Web give one figure for one track. Omitted for
   * a live recording and an import, which have nothing stored.
   */
  storedClimb?: { gainM: number; lossM: number; source?: string | null };
}) {
  const styles = useStyles();

  if (!detail) {
    return (
      <Text style={styles.pending}>
        {loading
          ? TRACK_PROFILE_COPY.reading
          : (emptyMessage ?? "No points recorded yet.")}
      </Text>
    );
  }

  // One source for every height on the panel, and the line saying which:
  // `trackHeights`, the rule Logjam Web's way page charts by too. The stat
  // list is `trackStatRows`, shared with that page for the same reason.
  const heights = trackHeights(detail, demProfile, demLoading ?? false);
  const { elevation, note: heightsNote } = heights;
  const stats: Stat[] = trackStatRows(detail, heights, {
    elapsedMs,
    storedClimb,
  });

  const speed = detail.speed;
  const formatClock = speed ? speedTimeFormatter(speed) : null;

  return (
    <View style={styles.body}>
      {/* Pairs share a line and a lone stat takes the row (`STAT_PAIRS`), so a
          missing Time or a missing pair cannot slide the rest out of step. */}
      <StatGrid stats={pairedStatLayout(stats)} />
      {/* The stored climb and the chart below can come from different sources
          (`storedClimbCaption`), so each says its own. */}
      {storedClimb ? (
        <Text style={styles.pending}>
          {storedClimbCaption(storedClimb.source)}
        </Text>
      ) : null}

      {elevation ? (
        <View style={styles.chartBlock}>
          <Text style={styles.chartLabel}>
            {TRACK_PROFILE_COPY.elevationTitle}
          </Text>
          <ProfileChart
            series={elevationSeries(elevation, detail.distanceM)}
            formatValue={(elevationM) => `${Math.round(elevationM)} m`}
            formatX={formatDistanceM}
            hint="Press or drag for heights."
            accessibilityLabel={TRACK_PROFILE_COPY.elevationLabel}
          />
          {/* Which surface these heights came from. Said out loud because the
              two can differ by a lot — a DEM cannot see inside a slot narrower
              than its ~19 m grid, and GPS altitude cannot see a hill smaller
              than its own noise. A number with no provenance gets trusted. */}
          <Text style={styles.pending}>{heightsNote}</Text>
        </View>
      ) : (
        <Text style={styles.pending}>{heightsNote}</Text>
      )}

      {speed && formatClock ? (
        <View style={styles.chartBlock}>
          <Text style={styles.chartLabel}>{TRACK_PROFILE_COPY.speedTitle}</Text>
          <ProfileChart
            series={speedSeries(speed)}
            formatValue={formatSpeedMps}
            // The speed series runs on a CLOCK, not a tape measure — its x is
            // time into the recording (see SpeedSample), read out as the time
            // of day it was: "where were we at 2 pm" is the question asked.
            formatX={formatClock}
            hint="Press or drag for speeds."
            accessibilityLabel={TRACK_PROFILE_COPY.speedLabel}
          />
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  body: { gap: spacing(1.5) },
  chartBlock: { gap: spacing(0.5) },
  chartLabel: { ...textRole.section, color: theme.textMuted },
  pending: { color: theme.textMuted, fontSize: fontSize.sm },
}));
