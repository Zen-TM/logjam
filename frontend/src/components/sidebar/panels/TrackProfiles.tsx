// A track file's figures and its two charts on its page: height against
// distance, speed against time. What Logjam GPS's stats panel shows for the
// same file (`mobile/src/tracks/TrackStatsBody.tsx`), from the same shared
// stat list (`trackStatRows`), series, rule for which heights to chart
// (`trackHeights`) and words.
//
// A file with no line draws no chart: there is nothing to chart, and the
// figures its row carries already say what the file holds. A file without
// times has no honest speed, so that chart and the clock figures are absent
// rather than flat or zero.
import { useCallback, useMemo } from "react";
import {
  densifyLineSegments,
  elevationSeries,
  formatDistanceM,
  formatElevationM,
  formatSpeedMps,
  pairedStatLayout,
  speedClockMs,
  speedSeries,
  speedTimeFormatter,
  TRACK_PROFILE_COPY,
  trackHeights,
  trackStatRows,
} from "@logjam/shared";
import { useElevationProfile } from "../../../placeUtils";
import type { RouteHoverChannel } from "../../map/routeHover";
import {
  useTrackFileDetail,
  type TrackFileSource,
} from "../../media/useTrackFileDetail";
import { ProfileChart, SectionHeader, StatGrid, type Stat } from "../../../ui";
import classes from "./WayDetailPanel.module.css";

export default function TrackProfiles({
  source,
  stored,
  color,
  routeHover,
}: {
  source: TrackFileSource;
  /** The figures the file's own row carries. They are listed as they are, in
   *  the file's place in the list; the file fills in the rest. */
  stored: Stat[];
  /** The track's map colour, so the charts and the line agree on identity. */
  color: string | null;
  /** Where a chart's cursor sits, so the map marks it. */
  routeHover: RouteHoverChannel;
}): React.JSX.Element {
  const { detail, line, series, loading, error } = useTrackFileDetail(source);
  const { profile: demProfile, loading: demLoading } = useElevationProfile(
    line.length > 0 ? line : null,
  );

  const heights = useMemo(
    () => (detail ? trackHeights(detail, demProfile, demLoading) : null),
    [detail, demProfile, demLoading],
  );
  const elevation = useMemo(
    () =>
      detail && heights?.elevation
        ? elevationSeries(heights.elevation, detail.distanceM)
        : null,
    [detail, heights],
  );
  const speed = detail?.speed ?? null;
  const speedChart = useMemo(
    () =>
      speed
        ? { series: speedSeries(speed), formatX: speedTimeFormatter(speed) }
        : null,
    [speed],
  );

  // The spot under the cursor, as a fraction of the way along the thinned line
  // the terrain was read from. A fraction rather than a sample index because
  // the heights may be the track's own GPS ones, which are not sampled at
  // these positions; either way a feature sits at the same fraction along.
  const positions = useMemo(() => densifyLineSegments(line), [line]);
  const handleHover = useCallback(
    (index: number | null) => {
      const points = elevation?.points;
      const last = positions[positions.length - 1];
      if (index == null || !points || !last) {
        routeHover.set(null);
        return;
      }
      const alongM =
        (points[index]!.x / points[points.length - 1]!.x) * last.distanceM;
      let nearest = positions[0]!;
      for (const position of positions) {
        if (
          Math.abs(position.distanceM - alongM) <
          Math.abs(nearest.distanceM - alongM)
        )
          nearest = position;
      }
      routeHover.set({ position: [nearest.lon, nearest.lat], color });
    },
    [elevation, positions, routeHover, color],
  );

  // The speed chart runs on the clock, so its cursor is a time of day: the
  // map marks the fix recorded nearest to it.
  // ponytail: a scan of every fix per frame, about a millisecond at the upload
  // ceiling; a binary search per segment if a longer file is ever allowed.
  const handleSpeedHover = useCallback(
    (index: number | null) => {
      const sample = index == null ? null : speed?.samples[index];
      if (!speed || !sample) {
        routeHover.set(null);
        return;
      }
      const clockMs = speedClockMs(speed, sample.atMs);
      let nearest: (typeof series)[number] | null = null;
      let nearestMs = Infinity;
      for (const fix of series) {
        if (fix.timestampMs == null) continue;
        const awayMs = Math.abs(fix.timestampMs - clockMs);
        if (awayMs < nearestMs) {
          nearest = fix;
          nearestMs = awayMs;
        }
      }
      routeHover.set(
        nearest ? { position: [nearest.lon, nearest.lat], color } : null,
      );
    },
    [speed, series, routeHover, color],
  );

  // One grid, in Logjam GPS's order. A figure the row already carries stays
  // the row's; what only the row knows (its size) follows the track's own.
  const stats = useMemo(() => {
    if (!detail || !heights) return stored;
    const rows: Stat[] = trackStatRows(detail, heights);
    const listed = new Set(rows.map((row) => row.label));
    return [
      ...rows.map(
        (row) => stored.find((stat) => stat.label === row.label) ?? row,
      ),
      ...stored.filter((stat) => !listed.has(stat.label)),
    ];
  }, [detail, heights, stored]);
  const grid = stats.length > 0 && <StatGrid stats={pairedStatLayout(stats)} />;

  if (loading || error || !detail || !heights)
    return (
      <>
        {grid}
        {(loading || error) && (
          <p className={classes.note}>
            {loading ? TRACK_PROFILE_COPY.reading : error}
          </p>
        )}
      </>
    );

  return (
    <>
      {grid}
      <section className={classes.section}>
        {elevation && (
          <>
            <SectionHeader title={TRACK_PROFILE_COPY.elevationTitle} />
            <ProfileChart
              series={elevation}
              formatValue={formatElevationM}
              formatX={formatDistanceM}
              label={TRACK_PROFILE_COPY.elevationLabel}
              color={color ?? "currentColor"}
              onHoverPointChange={handleHover}
            />
          </>
        )}
        {/* Which surface the heights came from, or why there is no chart: the
            terrain and a GPS can differ by a lot, and a number with no
            provenance gets trusted. */}
        <p className={classes.note}>{heights.note}</p>
        {heights.dem && demProfile && (
          <p className={classes.attribution}>{demProfile.attribution}</p>
        )}
      </section>

      {speedChart && (
        <section className={classes.section}>
          <SectionHeader title={TRACK_PROFILE_COPY.speedTitle} />
          <ProfileChart
            series={speedChart.series}
            formatValue={formatSpeedMps}
            formatX={speedChart.formatX}
            label={TRACK_PROFILE_COPY.speedLabel}
            color={color ?? "currentColor"}
            onHoverPointChange={handleSpeedHover}
          />
        </section>
      )}
    </>
  );
}
