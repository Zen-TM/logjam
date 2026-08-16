// Map layers for recorded tracks + waypoints (Stage 7). Rendered inside
// MapView; sources are unpinned so they draw above the basemap/overlay bands —
// mount this BEFORE the canyon sources so canyons stay on top.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleLayer,
  LineLayer,
  ShapeSource,
  SymbolLayer,
} from "@maplibre/maplibre-react-native";
import type { RecordedTrackPoint } from "@logjam/shared";

import { theme } from "../theme";
import { listTrackPoints, type Track, type Waypoint } from "./tracksDb";
import { trackPointsToFeature } from "./trackGeoJson";

const WAYPOINT_COLOR = "#f97316"; // matches the owned-canyon orange family

/** Where on the map a press landed — passed through so a caller can place a
 *  point there when a tool is armed (the layer swallowed the press first). */
export type TrackPressCoordinates = { latitude: number; longitude: number };

// Stable identity for "no points loaded yet" — a fresh [] per render would
// defeat TrackLine's memo.
const EMPTY_POINTS: RecordedTrackPoint[] = [];

/**
 * One track's line. Memoised, and so is the geometry inside it: MapScreen
 * re-renders at the compass cadence (up to ~5/s while the tape or locate-me runs),
 * and rebuilding a growing MultiLineString per render handed the native source
 * a new `shape` object several times a second on the screen the user carries while
 * walking (MLIFE-003). Now the geometry is rebuilt only when the stored points,
 * the live tail or the segment actually change.
 */
const TrackLine = memo(function TrackLine({
  track,
  stored,
  liveCoord,
  onPress,
}: {
  track: Track;
  stored: RecordedTrackPoint[];
  liveCoord: [number, number] | null;
  onPress: (track: Track, coordinates?: TrackPressCoordinates) => void;
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

  if (shape.geometry.coordinates.length === 0) return null;
  return (
    <ShapeSource
      id={`track-${track.id}`}
      shape={shape}
      // A 3px line is far thinner than a fingertip, so without a hitbox the
      // line is technically tappable and practically not. 44pt is the platform
      // minimum touch target, and it is the right number here for the same
      // reason it is on the saved routes (RoutesLayer.tsx).
      hitbox={{ width: 44, height: 44 }}
      onPress={(event) => onPress(track, event.coordinates)}
    >
      <LineLayer
        id={`track-line-${track.id}`}
        style={{
          lineColor: track.color,
          lineWidth: 3,
          lineOpacity: 0.9,
          lineJoin: "round",
          lineCap: "round",
        }}
      />
    </ShapeSource>
  );
});

// Memoised: every prop is stable across a compass-driven re-render of
// MapScreen (tracks/waypoints come from useTracks' state, liveCoord from a
// fix, onWaypointPress is a useCallback), so the whole subtree is skipped
// instead of re-walking every visible track on every compass sample.
export const TrackMapLayers = memo(function TrackMapLayers({
  tracks,
  waypoints,
  liveCoord,
  onWaypointPress,
  onTrackPress,
}: {
  tracks: Track[];
  waypoints: Waypoint[];
  /**
   * The map's own latest fix, drawn as the live tail of the track being
   * recorded. Recorded points reach SQLite through Android's JobScheduler,
   * which batches: the stored line grew several segments at a time and then
   * sat still, trailing the location marker by a visible gap until the next
   * batch landed. The tail closes that gap with the same fix the marker is
   * drawn from — it is only ever the last leg, so nothing here is stored, and
   * the batch that follows replaces it with the real points.
   */
  liveCoord: [number, number] | null;
  onWaypointPress: (waypoint: Waypoint) => void;
  /** Tapping a recorded line opens its options. Stable identity required —
   *  TrackLine is memoised against MapScreen's compass-rate re-render. */
  onTrackPress: (track: Track, coordinates?: TrackPressCoordinates) => void;
}) {
  const visibleTracks = tracks.filter((track) => track.visible);
  // Point sets per visible track, reloaded whenever the tracks list changes
  // (appendTrackPoints bumps the track row, so live recording re-renders on
  // each written batch).
  const [pointsById, setPointsById] = useState<Map<string, RecordedTrackPoint[]>>(
    new Map(),
  );
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
        // INCREMENTAL. This used to re-read every point of every visible track
        // on each written batch, then rebuild and re-serialise the whole
        // MultiLineString — O(points) of SQLite and JSON per fix, quadratic
        // over a recording, on the screen that stays open for the trip. It is
        // the same fault `trackRecorder`'s point cache was built to fix
        // (MLIFE-004), on the render side.
        const have = held.get(track.id) ?? EMPTY_POINTS;
        // Fewer stored than held means the series was rewritten underneath us
        // (a discarded track, a wipe) — start again rather than concatenate
        // onto points that no longer exist.
        const from = have.length <= track.pointCount ? have.length : 0;
        const fresh = await listTrackPoints(track.id, from);
        if (from === 0) return [track.id, fresh] as const;
        // Identity matters: an unchanged track must hand TrackLine the SAME
        // array, or its memo (and the geometry inside it) rebuilds anyway.
        return [track.id, fresh.length === 0 ? have : have.concat(fresh)] as const;
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

  // Same reason as TrackLine: rebuilt when the waypoints change, not on every
  // compass tick.
  const waypointShape = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: waypoints.map((waypoint) => ({
        type: "Feature" as const,
        id: waypoint.id,
        geometry: {
          type: "Point" as const,
          coordinates: [waypoint.lon, waypoint.lat],
        },
        properties: {
          id: waypoint.id,
          name: waypoint.name,
          // Per-feature so one layer paints every tag; a match
          // expression here would duplicate the lookup table.
          color: waypoint.color ?? WAYPOINT_COLOR,
        },
      })),
    }),
    [waypoints],
  );

  return (
    <>
      {visibleTracks.map((track) => (
        <TrackLine
          key={track.id}
          track={track}
          stored={pointsById.get(track.id) ?? EMPTY_POINTS}
          liveCoord={liveCoord}
          onPress={onTrackPress}
        />
      ))}
      {waypoints.length > 0 ? (
        <ShapeSource
          id="waypoints"
          shape={waypointShape}
          onPress={(event) => {
            const id = event.features[0]?.properties?.id as string | undefined;
            const waypoint = waypoints.find((w) => w.id === id);
            if (waypoint) onWaypointPress(waypoint);
          }}
        >
          <CircleLayer
            id="waypoint-markers"
            style={{
              circleRadius: 6,
              circleColor: ["get", "color"] as unknown as string,
              circleStrokeColor: "#ffffff",
              circleStrokeWidth: 2,
            }}
          />
          <SymbolLayer
            id="waypoint-labels"
            style={{
              textField: ["get", "name"] as unknown as string,
              textFont: ["Noto Sans Medium"],
              textSize: 11,
              textColor: theme.textPrimary,
              textHaloColor: theme.bonus2,
              textHaloWidth: 1,
              textAnchor: "top",
              textOffset: [0, 0.8],
            }}
          />
        </ShapeSource>
      ) : null}
    </>
  );
});
