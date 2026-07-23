// Map layers for recorded tracks + waypoints (Stage 7). Rendered inside
// MapView; sources are unpinned so they draw above the basemap/overlay bands —
// mount this BEFORE the canyon sources so canyons stay on top.
import { useEffect, useState } from "react";
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

export function TrackMapLayers({
  tracks,
  waypoints,
  onWaypointPress,
}: {
  tracks: Track[];
  waypoints: Waypoint[];
  onWaypointPress: (waypoint: Waypoint) => void;
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
  useEffect(() => {
    let mounted = true;
    Promise.all(
      visibleTracks.map(
        async (track) => [track.id, await listTrackPoints(track.id)] as const,
      ),
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
      {visibleTracks.map((track) => {
        const points = pointsById.get(track.id);
        if (!points || points.length < 2) return null;
        return (
          <ShapeSource
            key={track.id}
            id={`track-${track.id}`}
            shape={trackPointsToFeature(points)}
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
      })}
      {waypoints.length > 0 ? (
        <ShapeSource
          id="waypoints"
          shape={{
            type: "FeatureCollection",
            features: waypoints.map((waypoint) => ({
              type: "Feature" as const,
              id: waypoint.id,
              geometry: {
                type: "Point" as const,
                coordinates: [waypoint.lon, waypoint.lat],
              },
              properties: { id: waypoint.id, name: waypoint.name },
            })),
          }}
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
              circleColor: WAYPOINT_COLOR,
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
}
