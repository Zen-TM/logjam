// A track file's two charts on its page: height against distance, speed
// against time. What Logjam GPS's stats panel draws for the same file
// (`mobile/src/tracks/TrackStatsBody.tsx`), from the same shared series, rule
// for which heights to chart (`trackHeights`) and words.
//
// A file with no line draws nothing: there is nothing to chart, and the
// figures above already say what the file holds. A file without times has no
// honest speed, so that chart is absent rather than flat.
import { useCallback, useMemo } from "react";
import {
  densifyLineSegments,
  elevationSeries,
  formatDistanceM,
  formatElevationM,
  formatSpeedMps,
  speedSeries,
  speedTimeFormatter,
  TRACK_PROFILE_COPY,
  trackHeights,
} from "@logjam/shared";
import { useElevationProfile } from "../../../placeUtils";
import type { RouteHoverChannel } from "../../map/routeHover";
import {
  useTrackFileDetail,
  type TrackFileSource,
} from "../../media/useTrackFileDetail";
import { ProfileChart, SectionHeader } from "../../../ui";
import classes from "./WayDetailPanel.module.css";

export default function TrackProfiles({
  source,
  color,
  routeHover,
}: {
  source: TrackFileSource;
  /** The track's map colour, so the charts and the line agree on identity. */
  color: string | null;
  /** Where the elevation cursor sits, so the map marks it. */
  routeHover: RouteHoverChannel;
}): React.JSX.Element | null {
  const { detail, line, loading, error } = useTrackFileDetail(source);
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

  if (loading)
    return <p className={classes.note}>{TRACK_PROFILE_COPY.reading}</p>;
  if (error) return <p className={classes.note}>{error}</p>;
  if (!detail || !heights) return null;

  return (
    <>
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
          />
        </section>
      )}
    </>
  );
}
