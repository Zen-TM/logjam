// Map layers for recorded tracks. Rendered inside
// Map; sources are unpinned so they draw above the basemap/overlay bands —
// mount this BEFORE the place sources so places stay on top.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { GeoJSONSource, Layer } from "@maplibre/maplibre-react-native";
import {
  trackPassesNear,
  type RecordedTrackPoint,
  type TrackPass,
} from "@logjam/shared";

import { listTrackPoints, type Track } from "./tracksDb";
import { trackPointsToFeature } from "./trackGeoJson";
import { PLAN_DIM } from "../plans/planMap";
import { PIN_FLOOR } from "../map/layerOrder";
import { stopSourcePress } from "../map/sourcePress";

/** Where on the map a press landed — passed through so a caller can place a
 *  point there when a tool is armed (the layer swallowed the press first). */
export type TrackPressCoordinates = { latitude: number; longitude: number };

/**
 * A press on a track: the track, where the press landed, and when the track
 * was at that spot (empty for a press that is not asking, see MapScreen).
 */
export type TrackPressHandler = (
  track: Track,
  coordinates?: TrackPressCoordinates,
  passes?: TrackPass[],
) => void;

// Stable identity for "no points loaded yet" — a fresh [] per render would
// defeat TrackLine's memo.
const EMPTY_POINTS: RecordedTrackPoint[] = [];

/**
 * One track's line. Memoised, and so is the geometry inside it: MapScreen
 * re-renders at the compass cadence (up to ~5/s while the tape or locate-me runs),
 * and avoiding rebuilding a growing MultiLineString per render prevents handing
 * the native source a new `shape` object several times a second on the screen
 * the user carries while walking. The geometry rebuilds only when the stored
 * points, the live tail or the segment actually change.
 */
const TrackLine = memo(function TrackLine({
  track,
  stored,
  liveCoord,
  dim,
  onPress,
}: {
  track: Track;
  stored: RecordedTrackPoint[];
  liveCoord: [number, number] | null;
  dim: boolean;
  onPress: TrackPressHandler;
}) {
  const tail = track.state === "recording" ? liveCoord : null;
  const shape = useMemo(() => {
    const points = tail
      ? [
          ...stored,
          {
            lon: tail[0],
            lat: tail[1],
            altitudeM: null,
            accuracyM: null,
            timestampMs: Date.now(),
            segment: track.currentSegment,
          },
        ]
      : stored;
    return trackPointsToFeature(points);
  }, [stored, tail, track.currentSegment]);

  // MOUNTED EVEN WHILE EMPTY (a MultiLineString with no coordinates draws
  // nothing). Adding a source only when the first points land would insert a
  // layer ABOVE the location marker mid-recording — the marker's
  // re-insertion key in MapScreen can see this track's id, but not the moment
  // its points arrive.
  return (
    <GeoJSONSource
      id={`track-${track.id}`}
      data={shape}
      // A 3px line is far thinner than a fingertip, so without a hitbox the
      // line is technically tappable and practically not. MLRN defaults it to
      // 44pt — the platform minimum touch target, and the right number here
      // for the same reason it is on the saved routes (RoutesLayer.tsx).
      onPress={(event) => {
        stopSourcePress(event);
        const [longitude, latitude] = event.nativeEvent.lngLat;
        // The stored points are already in memory for the line, so the
        // answer costs one pass over them and no read.
        onPress(
          track,
          { latitude, longitude },
          trackPassesNear(stored, { lat: latitude, lon: longitude }),
        );
      }}
    >
      <Layer
        key={`track-line-${track.id}`}
        type="line"
        id={`track-line-${track.id}`}
        // A track recorded or switched on after the pins mounted must still
        // draw under them (map/layerOrder.ts).
        beforeId={PIN_FLOOR}
        style={{
          lineColor: track.color,
          lineWidth: 3,
          lineOpacity: dim ? PLAN_DIM : 0.9,
          lineJoin: "round",
          lineCap: "round",
        }}
      />
    </GeoJSONSource>
  );
});

// Memoised: every prop is stable across a compass-driven re-render of
// MapScreen (tracks/waypoints come from useTracks' state, liveCoord from a
// fix, onWaypointPress is a useCallback), so the whole subtree is skipped
// instead of re-walking every visible track on every compass sample.
export const TrackMapLayers = memo(function TrackMapLayers({
  tracks,
  liveCoord,
  showTracks,
  dim = false,
  onTrackPress,
}: {
  tracks: Track[];
  /**
   * The map's own latest fix, drawn as the live tail of the track being
   * recorded. Recorded points reach SQLite through Android's JobScheduler,
   * which batches: without the tail, the stored line grows several segments
   * at a time and trails the location marker by a visible gap until the next
   * batch lands. The tail closes that gap with the same fix the marker is
   * drawn from — it is only ever the last leg, so nothing here is stored, and
   * the batch that follows replaces it with the real points.
   */
  liveCoord: [number, number] | null;
  /** The Tracks master switch. A live recording/paused track still draws even
   *  when this is off — the layer sheet's switch governs saved tracks. */
  showTracks: boolean;
  /** Faint, under a plan on the map. */
  dim?: boolean;
  /** Tapping a recorded line opens its options. Stable identity required —
   *  TrackLine is memoised against MapScreen's compass-rate re-render. */
  onTrackPress: TrackPressHandler;
}) {
  const visibleTracks = tracks.filter(
    (track) => track.visible && (track.state !== "done" || showTracks),
  );
  // Point sets per visible track, reloaded whenever the tracks list changes
  // (appendTrackPoints bumps the track row, so live recording re-renders on
  // each written batch).
  const [pointsById, setPointsById] = useState<
    Map<string, RecordedTrackPoint[]>
  >(new Map());
  const reloadKey = visibleTracks
    .map((track) => `${track.id}:${track.pointCount}`)
    .join("|");
  // Read without re-subscribing: the effect below wants the points it already
  // holds, but depending on them would make every load trigger the next one.
  const heldPoints = useRef(pointsById);
  heldPoints.current = pointsById;
  useEffect(() => {
    let mounted = true;
    const held = heldPoints.current;
    Promise.all(
      visibleTracks.map(async (track) => {
        // INCREMENTAL. Reading incrementally avoids re-reading every point of
        // every visible track on each written batch and rebuilding the whole
        // MultiLineString — quadratic SQLite and JSON work over a recording,
        // on the screen that stays open for the trip. It matches the point
        // cache in `trackRecorder` on the render side.
        const have = held.get(track.id) ?? EMPTY_POINTS;
        // Fewer stored than held means the series was rewritten underneath us
        // (a discarded track, a wipe) — start again rather than concatenate
        // onto points that no longer exist.
        const from = have.length <= track.pointCount ? have.length : 0;
        const fresh = await listTrackPoints(track.id, from);
        if (from === 0) return [track.id, fresh] as const;
        // Identity matters: an unchanged track must hand TrackLine the SAME
        // array, or its memo (and the geometry inside it) rebuilds anyway.
        return [
          track.id,
          fresh.length === 0 ? have : have.concat(fresh),
        ] as const;
      }),
    )
      .then((entries) => {
        if (mounted) setPointsById(new Map(entries));
      })
      .catch(console.error);
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  return (
    <>
      {visibleTracks.map((track) => (
        <TrackLine
          key={track.id}
          track={track}
          stored={pointsById.get(track.id) ?? EMPTY_POINTS}
          liveCoord={liveCoord}
          dim={dim}
          onPress={onTrackPress}
        />
      ))}
    </>
  );
});
