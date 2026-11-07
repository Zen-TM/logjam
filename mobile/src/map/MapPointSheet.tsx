// "What's there?" — the panel a tap on the map opens.
//
// The map answers where things are. Long-press already means "something
// goes HERE" (a marker, a canyon), which is a commitment; a tap is the
// question that comes before it, and it answers the facts a canyoner
// actually wants off a map — where it is, how high it is, and how far and which
// way it is from them — with one Options row for the things they might do
// about it. The coordinates copy where they are pressed.
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
  mapPointStepBack,
  mapPointVerbs,
  type MapPointCoord,
  type MapPointElevation,
  type MapPointView,
} from "@logjam/shared";

import { spacing, makeStyles, muted } from "../theme";
import { BottomSheet, Row, StatGrid, type Stat } from "../ui";
import { slopeAt } from "../offline/demLookup";
import { useElevationProfile } from "./useElevationProfile";
import { useWeather } from "../weather/useWeather";
import { showWeatherRow } from "../weather/weatherState";
import { WeatherView } from "../weather/WeatherView";
import type { MapHoldRun } from "./MapHoldSheet";

/** A bare lat/lng, as the map hands one back from a tap. */
export type MapPoint = MapPointCoord;

/** The viewer's own fix, when the point is it: the platform's own figures. */
export type OwnFix = {
  atMs: number;
  accuracyM: number | null;
  /** What the receiver reported; the terrain's height is asked for first. */
  altitudeM: number | null;
};

export function MapPointSheet({
  point,
  userCoord,
  land,
  fire,
  coverage,
  onClose,
  onClosed,
  run,
  onInfo,
  allowNetwork,
  savedHereOnly,
  fix,
}: {
  point: MapPoint | null;
  /** Set when the point is the viewer's own position (a press on the arrow):
   *  then the sheet is about the fix, and offers nothing to do with it. */
  fix?: OwnFix | null;
  /** The land class drawn at the point, or null: the Land overlay off or empty there. */
  land: string | null;
  /** The latest fire at the point, or null: the Fire history overlay off or empty there. */
  fire: string | null;
  /** The carrier's predicted coverage at the point, or null: the Coverage overlay off or clear there. */
  coverage: string | null;
  /** Latest fix as [lon, lat], or null when the dot isn't running. */
  userCoord: [number, number] | null;
  onClose: () => void;
  /** After the sheet has gone: the place form cannot open over it. */
  onClosed: () => void;
  /** What each verb in Options does. Each one dismisses the sheet itself. */
  run: MapHoldRun;
  /** Transient feedback channel — the map's own toast. */
  onInfo: (message: string) => void;
  /**
   * False in "Simulating offline mode": elevation then comes only from tiles
   * already on the phone, and nothing goes out.
   */
  /** Not yet known to be synced: offline, a change queued, or no account. */
  savedHereOnly?: boolean;
  allowNetwork?: boolean;
}) {
  // Options and the weather replace the facts in place and back out one step
  // (shared/DESIGN.md §10); a new point starts on the facts.
  const [step, setStep] = useState<{
    point: MapPoint;
    view: "options" | "weather";
  } | null>(null);
  const view: MapPointView =
    point !== null && step?.point === point ? step.view : "point";
  const show = (next: MapPointView) =>
    setStep(point && next !== "point" ? { point, view: next } : null);
  // The back gesture, the scrim and the swipe undo one layer, as the arrow
  // does (shared/DESIGN.md §3); from the facts they close.
  const back = mapPointStepBack(view);
  return (
    <BottomSheet
      visible={point !== null}
      onClose={back ? () => show(back) : onClose}
      onClosed={onClosed}
      title={
        view === "weather"
          ? WEATHER.title
          : view === "options"
            ? MAP_POINT.copy.options
            : fix
              ? MAP_POINT.copy.fixTitle
              : MAP_POINT.title
      }
      onBack={back ? () => show(back) : undefined}
    >
      {/* Mounted only with a point, so the elevation request inside is tied to
          the sheet being open rather than firing for a stale coordinate every
          time the map re-renders. */}
      {point && fix ? (
        <FixDetail
          key={`${point.latitude},${point.longitude}`}
          point={point}
          fix={fix}
          allowNetwork={allowNetwork}
          onInfo={onInfo}
        />
      ) : point ? (
        <PointDetail
          // A new point starts clean: its height must not be the last one's.
          key={`${point.latitude},${point.longitude}`}
          point={point}
          land={land}
          fire={fire}
          coverage={coverage}
          userCoord={userCoord}
          run={run}
          onInfo={onInfo}
          allowNetwork={allowNetwork}
          savedHereOnly={savedHereOnly}
          view={view}
          onView={show}
        />
      ) : null}
    </BottomSheet>
  );
}

/**
 * The viewer's own position, as the receiver last gave it. Nothing to do with
 * it, so no verbs, no slope and no forecast: only the figures, and none of them
 * asks anyone anything but the terrain tiles the map already reads.
 */
function FixDetail({
  point,
  fix,
  allowNetwork = true,
  onInfo,
}: {
  point: MapPoint;
  fix: OwnFix;
  allowNetwork?: boolean;
  onInfo: (message: string) => void;
}) {
  const styles = useStyles();
  // The sheet is mounted per point, so this is when the fix was asked about.
  const [openedAt] = useState(() => Date.now());
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
  const terrainM = profile?.samples[0]?.elevationM ?? null;
  // The terrain's height only; the receiver's own, labelled as that, once no
  // terrain figure is coming (offline, which is when a fix is wanted most).
  const elevation: MapPointElevation =
    terrainM != null
      ? { state: "known", metres: terrainM }
      : loading
        ? { state: "checking" }
        : fix.altitudeM != null
          ? { state: "receiver", metres: fix.altitudeM }
          : { state: "unavailable" };
  const stats: Stat[] = mapPointFacts({
    point,
    elevation,
    from: null,
    fix: { atMs: fix.atMs, accuracyM: fix.accuracyM, nowMs: openedAt },
  }).map((fact) => ({
    label: fact.label,
    value: fact.value,
    ...(fact.note ? { note: fact.note } : {}),
    ...(fact.span ? { span: true } : {}),
    ...(fact.copyable
      ? {
          onCopy: () => {
            Clipboard.setString(mapPointPosition(point));
            onInfo(MAP_POINT.copy.coordinatesCopied);
          },
        }
      : {}),
  }));
  return (
    <View style={styles.body}>
      <StatGrid stats={stats} />
    </View>
  );
}

function PointDetail({
  point,
  land,
  fire,
  coverage,
  userCoord,
  run,
  onInfo,
  allowNetwork = true,
  savedHereOnly = false,
  view,
  onView,
}: {
  point: MapPoint;
  land: string | null;
  fire: string | null;
  coverage: string | null;
  userCoord: [number, number] | null;
  run: MapHoldRun;
  onInfo: (message: string) => void;
  allowNetwork?: boolean;
  savedHereOnly?: boolean;
  view: MapPointView;
  onView: (view: MapPointView) => void;
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
    view === "weather" ? pressedElevation : elevationM,
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
    land,
    fire,
    coverage,
  }).map((fact) => ({
    label: fact.label,
    value: fact.value,
    ...(fact.note ? { note: fact.note } : {}),
    ...(fact.span ? { span: true } : {}),
    ...(fact.copyable ? { onCopy: copyPosition } : {}),
  }));

  if (view === "weather") return <WeatherView weather={weather} />;

  if (view === "options")
    return (
      <View style={styles.body}>
        {mapPointVerbs("gps", savedHereOnly).map((verb) => (
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
              // The one verb that keeps the sheet: the forecast replaces the
              // options, and the press is what asks for it.
              if (verb.id === "weather") {
                setPressedElevation(elevationM);
                onView("weather");
                weather.refresh();
                return;
              }
              run[verb.id as keyof MapHoldRun](point);
            }}
          />
        ))}
      </View>
    );

  return (
    <View style={styles.body}>
      <StatGrid stats={stats} />
      {userCoord == null ? (
        <Text style={styles.note}>{MAP_POINT_NO_FIX_NOTE.gps}</Text>
      ) : null}
      <Row
        icon="overflow"
        title={MAP_POINT.copy.options}
        onPress={() => onView("options")}
      />
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  body: { gap: spacing(1) },
  note: { ...muted(theme, textRole.detail) },
}));
