// "What's there?" — the panel a tap on the map opens.
//
// The map answers where things are. Long-press already means "something
// goes HERE" (a marker, a canyon), which is a commitment; a tap is the
// question that comes before it, and it answers the four facts a canyoner
// actually wants off a map — where it is, how high it is, and how far and which
// way it is from them — plus the two things they might do about it.
//
// PRIVACY (shared/DESIGN.md §13): a coordinate and a distance-from-me belong on a
// DETAIL surface, which is what this is — the user asked about this exact spot.
// The list rule is unaffected, and nothing here is logged or persisted: the
// point lives in the map screen's state until the sheet is dismissed.
import { useEffect, useMemo, useState } from "react";
import { Clipboard, Text, View } from "react-native";
import {
  MAP_POINT,
  MAP_POINT_NO_FIX_NOTE,
  WEATHER,
  mapPointFacts,
  mapPointPosition,
  mapPointVerbs,
  type MapPointCoord,
  type MapPointVerbId,
} from "@logjam/shared";

import { spacing, makeStyles, muted } from "../theme";
import { BottomSheet, Row, StatGrid, type Stat } from "../ui";
import { slopeAt } from "../offline/demLookup";
import { useElevationProfile } from "./useElevationProfile";
import { useWeather } from "../weather/useWeather";
import { showWeatherRow } from "../weather/weatherState";
import { WeatherView } from "../weather/WeatherView";

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
  // The weather replaces the facts in place and backs out to them
  // (shared/DESIGN.md §10); a new point starts on the facts.
  const [weatherPoint, setWeatherPoint] = useState<MapPoint | null>(null);
  const weatherOpen = point !== null && weatherPoint === point;
  const closeWeather = () => setWeatherPoint(null);
  return (
    <BottomSheet
      visible={point !== null}
      onClose={weatherOpen ? closeWeather : onClose}
      title={weatherOpen ? WEATHER.title : MAP_POINT.title}
      onBack={weatherOpen ? closeWeather : undefined}
    >
      {/* Mounted only with a point, so the elevation request inside is tied to
          the sheet being open rather than firing for a stale coordinate every
          time the map re-renders. */}
      {point ? (
        <PointDetail
          // A new point starts clean: its height must not be the last one's.
          key={`${point.latitude},${point.longitude}`}
          point={point}
          userCoord={userCoord}
          onClose={onClose}
          onNavigate={onNavigate}
          onDropMarker={onDropMarker}
          onInfo={onInfo}
          allowNetwork={allowNetwork}
          weatherOpen={weatherOpen}
          onShowWeather={() => setWeatherPoint(point)}
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
  weatherOpen,
  onShowWeather,
}: {
  point: MapPoint;
  userCoord: [number, number] | null;
  onClose: () => void;
  onNavigate: (point: MapPoint) => void;
  onDropMarker: (point: MapPoint) => void;
  onInfo: (message: string) => void;
  allowNetwork?: boolean;
  weatherOpen: boolean;
  onShowWeather: () => void;
}) {
  const styles = useStyles();

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

  // Null until known, and null for good where only the coarse worldwide DEM
  // has heights: the figure is then simply absent, never a guess.
  const [slopeDeg, setSlopeDeg] = useState<number | null>(null);
  useEffect(() => {
    let current = true;
    // Never a failure to show, and not logged: the error could carry the point.
    slopeAt(point.longitude, point.latitude, { allowNetwork })
      .catch(() => null)
      .then((slope) => {
        if (current) setSlopeDeg(slope);
      });
    return () => {
      current = false;
    };
  }, [point.latitude, point.longitude, allowNetwork]);

  // The forecast's cell is fixed by the height the panel had at the press: a
  // height arriving later must not turn the view into another cell's.
  const [pressedElevation, setPressedElevation] = useState<number | null>(null);
  const weather = useWeather(
    point,
    weatherOpen ? pressedElevation : elevationM,
    allowNetwork,
  );
  const showRow = showWeatherRow(weather);

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
          : // Public tiles, so a guest with signal gets a height like anyone.
            { state: "unavailable" },
    from: userCoord
      ? { latitude: userCoord[1], longitude: userCoord[0] }
      : null,
    slopeDegrees: slopeDeg,
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

  if (weatherOpen) return <WeatherView weather={weather} />;

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
          subtitle={
            verb.id === "weather"
              ? showRow.reason
              : (verb.subtitle ?? undefined)
          }
          disabled={verb.id === "weather" && showRow.disabled}
          onPress={() => {
            // The one verb that keeps the panel: the forecast replaces the
            // facts, and the press is what asks for it.
            if (verb.id === "weather") {
              setPressedElevation(elevationM);
              onShowWeather();
              weather.refresh();
              return;
            }
            run[verb.id]?.();
            onClose();
          }}
        />
      ))}
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  body: { gap: spacing(1) },
  note: { ...muted(theme, textRole.detail) },
}));
