// "What's there?" — the panel a tap on the map opens.
//
// The map answers where things are; until now it could not answer anything
// about a spot you were only pointing at. Long-press already meant "something
// goes HERE" (a waypoint, a canyon), which is a commitment; a tap is the
// question that comes before it, and it deserves the four facts a canyoner
// actually wants off a map — where it is, how high it is, and how far and which
// way it is from them — plus the two things they might do about it.
//
// PRIVACY (DESIGN.md §11): a coordinate and a distance-from-me belong on a
// DETAIL surface, which is what this is — the user asked about this exact spot.
// The list rule is unaffected, and nothing here is logged or persisted: the
// point lives in the map screen's state until the sheet is dismissed.
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  compassPointFor,
  formatDistanceM,
  haversineMeters,
  initialBearingDegrees,
} from "@logjam/shared";

import { fontSize, spacing, theme } from "../theme";
import { BottomSheet, Row, StatGrid, type Stat } from "../ui";
import { useElevationProfile } from "./useElevationProfile";

/** A bare lat/lng, as the map hands one back from a tap. */
export type MapPoint = { latitude: number; longitude: number };

export function MapPointSheet({
  point,
  userCoord,
  onClose,
  onNavigate,
  onDropWaypoint,
  allowNetwork,
}: {
  point: MapPoint | null;
  /** Latest fix as [lon, lat], or null when the dot isn't running. */
  userCoord: [number, number] | null;
  onClose: () => void;
  onNavigate: (point: MapPoint) => void;
  onDropWaypoint: (point: MapPoint) => void;
  /**
   * False in "Simulating offline mode": elevation then comes only from tiles
   * already on the phone, and nothing goes out.
   */
  allowNetwork?: boolean;
}) {
  return (
    <BottomSheet visible={point !== null} onClose={onClose} title="This point">
      {/* Mounted only with a point, so the elevation request inside is tied to
          the sheet being open rather than firing for a stale coordinate every
          time the map re-renders. */}
      {point ? (
        <PointDetail
          point={point}
          userCoord={userCoord}
          onClose={onClose}
          onNavigate={onNavigate}
          onDropWaypoint={onDropWaypoint}
          allowNetwork={allowNetwork}
        />
      ) : null}
    </BottomSheet>
  );
}

function PointDetail({
  point,
  userCoord,
  onClose,
  onNavigate,
  onDropWaypoint,
  allowNetwork = true,
}: {
  point: MapPoint;
  userCoord: [number, number] | null;
  onClose: () => void;
  onNavigate: (point: MapPoint) => void;
  onDropWaypoint: (point: MapPoint) => void;
  allowNetwork?: boolean;
}) {
  // The elevation endpoint profiles a LINE, and the shortest legal one is two
  // points (MIN_ROUTE_POINTS). A degenerate line would divide by zero in
  // densifyLine, so the second point is nudged east by ~1 m — well inside the
  // DEM's own cell size, and far enough above the 6-decimal coordinate rounding
  // to survive it. Online-only and never treated as a failure: the hook returns
  // null offline, and null here means "not known", never "sea level".
  const profilePoints = useMemo<[number, number][]>(
    () => [
      [point.longitude, point.latitude],
      [point.longitude + 0.00001, point.latitude],
    ],
    [point.latitude, point.longitude],
  );
  const { profile, loading } = useElevationProfile(profilePoints, { allowNetwork });
  const elevationM = profile?.samples[0]?.elevationM ?? null;

  const distanceM = userCoord
    ? haversineMeters(userCoord[1], userCoord[0], point.latitude, point.longitude)
    : null;
  const bearingDeg = userCoord
    ? initialBearingDegrees(
        userCoord[1],
        userCoord[0],
        point.latitude,
        point.longitude,
      )
    : null;

  const stats: Stat[] = [
    {
      label: "Position",
      value: `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`,
    },
    {
      label: "Elevation",
      value:
        elevationM != null
          ? `${Math.round(elevationM)} m`
          : loading
            ? "Checking…"
            : // Says which of the reasons it is, because "—" on a screen you
              // opened in a gorge reads as a bug rather than as the DEM being
              // a network away. No longer ever "Needs an account": the tiles
              // are public, so a guest with signal gets a height like anyone.
              "Needs a connection",
    },
    ...(distanceM != null && bearingDeg != null
      ? [
          { label: "Distance", value: formatDistanceM(distanceM) },
          {
            label: "Bearing",
            value: `${compassPointFor(bearingDeg)} ${Math.round(bearingDeg)}°`,
          },
        ]
      : []),
  ];

  return (
    <View style={styles.body}>
      <StatGrid stats={stats} />
      {userCoord == null ? (
        <Text style={styles.note}>
          Tap the locate button to see how far this is from you.
        </Text>
      ) : null}
      <Row
        icon="navigation"
        title="Navigate to this point"
        subtitle="Live distance and bearing, without saving anything"
        onPress={() => {
          onNavigate(point);
          onClose();
        }}
      />
      <Row
        icon="map-pin"
        title="Drop a waypoint here"
        subtitle="Kept in Saved, and it syncs"
        onPress={() => {
          onDropWaypoint(point);
          onClose();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing(1) },
  note: { color: theme.textMuted, fontSize: fontSize.sm },
});
