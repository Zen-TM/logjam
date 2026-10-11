// "What's there?" — the panel a tap on the map opens.
//
// The map answers where things are; until now it could not answer anything
// about a spot you were only pointing at. Long-press already meant "something
// goes HERE" (a marker, a canyon), which is a commitment; a tap is the
// question that comes before it, and it deserves the four facts a canyoner
// actually wants off a map — where it is, how high it is, and how far and which
// way it is from them — plus the two things they might do about it.
//
// PRIVACY (shared/DESIGN.md §13): a coordinate and a distance-from-me belong on a
// DETAIL surface, which is what this is — the user asked about this exact spot.
// The list rule is unaffected, and nothing here is logged or persisted: the
// point lives in the map screen's state until the sheet is dismissed.
import { useMemo } from "react";
import { Clipboard, StyleSheet, Text, View } from "react-native";
import {
  MAP_POINT,
  MAP_POINT_NO_FIX_NOTE,
  mapPointFacts,
  mapPointPosition,
  mapPointVerbs,
  type MapPointCoord,
  type MapPointVerbId,
} from "@logjam/shared";

import { fontSize, spacing, theme } from "../theme";
import { BottomSheet, Row, StatGrid, type Stat } from "../ui";
import { useElevationProfile } from "./useElevationProfile";

/** A bare lat/lng, as the map hands one back from a tap. */
export type MapPoint = MapPointCoord;

export function MapPointSheet({
  point,
  userCoord,
  onClose,
  onNavigate,
  onDropMarker,
  onInfo,
  allowNetwork,
}: {
  point: MapPoint | null;
  /** Latest fix as [lon, lat], or null when the dot isn't running. */
  userCoord: [number, number] | null;
  onClose: () => void;
  onNavigate: (point: MapPoint) => void;
  onDropMarker: (point: MapPoint) => void;
  /** Transient feedback channel — the map's own toast. */
  onInfo: (message: string) => void;
  /**
   * False in "Simulating offline mode": elevation then comes only from tiles
   * already on the phone, and nothing goes out.
   */
  allowNetwork?: boolean;
}) {
  return (
    <BottomSheet
      visible={point !== null}
      onClose={onClose}
      title={MAP_POINT.title}
    >
      {/* Mounted only with a point, so the elevation request inside is tied to
          the sheet being open rather than firing for a stale coordinate every
          time the map re-renders. */}
      {point ? (
        <PointDetail
          point={point}
          userCoord={userCoord}
          onClose={onClose}
          onNavigate={onNavigate}
          onDropMarker={onDropMarker}
          onInfo={onInfo}
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
  onDropMarker,
  onInfo,
  allowNetwork = true,
}: {
  point: MapPoint;
  userCoord: [number, number] | null;
  onClose: () => void;
  onNavigate: (point: MapPoint) => void;
  onDropMarker: (point: MapPoint) => void;
  onInfo: (message: string) => void;
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
  const { profile, loading } = useElevationProfile([profilePoints], {
    allowNetwork,
  });
  const elevationM = profile?.samples[0]?.elevationM ?? null;

  const position = mapPointPosition(point);
  const copyPosition = () => {
    Clipboard.setString(position);
    onInfo(MAP_POINT.copy.coordinatesCopied);
  };
  const stats: Stat[] = mapPointFacts({
    point,
    elevation:
      elevationM != null
        ? { state: "known", metres: elevationM }
        : loading
          ? { state: "checking" }
          : // No longer ever "Needs an account": the tiles are public, so a
            // guest with signal gets a height like anyone.
            { state: "unavailable" },
    from: userCoord
      ? { latitude: userCoord[1], longitude: userCoord[0] }
      : null,
  }).map((fact) => ({
    label: fact.label,
    value: fact.value,
    ...(fact.span ? { span: true } : {}),
    ...(fact.copyable ? { onCopy: copyPosition } : {}),
  }));

  // What each verb does here. Declared once with its words in the contract.
  const run: Partial<Record<MapPointVerbId, () => void>> = {
    navigate: () => onNavigate(point),
    dropMarker: () => onDropMarker(point),
  };

  return (
    <View style={styles.body}>
      <StatGrid stats={stats} />
      {userCoord == null ? (
        <Text style={styles.note}>{MAP_POINT_NO_FIX_NOTE.gps}</Text>
      ) : null}
      {mapPointVerbs("gps").map((verb) => (
        <Row
          key={verb.id}
          icon={verb.icon}
          title={verb.label}
          subtitle={verb.subtitle ?? undefined}
          onPress={() => {
            run[verb.id]?.();
            onClose();
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing(1) },
  note: { color: theme.textMuted, fontSize: fontSize.sm },
});
