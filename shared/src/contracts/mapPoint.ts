// "WHAT IS HERE?": the small panel a press on empty map opens — a sheet on
// Logjam GPS's map, a popover anchored at the point on Logjam Web's. The map
// answers where things are; this answers what a spot you are only pointing at
// is: where it is, how high, and (with a fix) how far and which way from you,
// then one Options button that opens the things worth doing about it.
//
// The facts are one declaration both clients draw (`mapPointFacts`); the verbs
// are declared once with the client that has each. A tap asks and a
// press-and-hold commits (shared/DESIGN.md §3): the tap panel shows the facts
// and puts every verb behind Options, so the question is never crowded by the
// answers. The coordinates copy where they are pressed; there is no verb for it.
//
// PRIVACY (shared/DESIGN.md §13): a coordinate and a distance-from-me belong on
// a DETAIL surface, which is what this is: the user asked about this exact
// spot. Nothing here is logged, toasted or persisted; the point lives in the
// map's state until the panel is dismissed.
import { haversineMeters } from "../placeGeo.js";
import { gaugeAgo } from "./gauges.js";
import {
  compassPointFor,
  formatDistanceM,
  initialBearingDegrees,
} from "../trackStats.js";
import type { IconIdea } from "../icons.js";
import { MAP_MEASURE, MAP_MEASURE_ICON } from "./mapMeasure.js";
import type { ContractPlatform, ScreenContract } from "./types.js";
import { WEATHER } from "./weather.js";

export const MAP_POINT = {
  id: "map.point",
  question: "What is at this spot?",
  title: "This point",
  sections: [
    { key: "position" },
    { key: "elevation" },
    // The fix itself, when the point IS the viewer's own position (a press on
    // the location arrow on Logjam GPS).
    {
      key: "accuracy",
      on: "gps",
      reason: "a call for help is made from the field",
    },
    {
      key: "fixAge",
      on: "gps",
      reason: "a call for help is made from the field",
    },
    // Both need a location fix the device ALREADY has: neither client asks for
    // one to show them.
    { key: "distance" },
    { key: "bearing" },
    // From the API's point route on Logjam Web and from the DEM tiles on
    // Logjam GPS; both say nothing where the fine DEM cannot tell.
    { key: "slope" },
    // Read from the Land overlay's own tiles on the device, only while it is
    // drawn: no coordinate goes anywhere for this.
    { key: "land" },
  ],
  copy: {
    position: "Position",
    elevation: "Elevation",
    distance: "Distance",
    bearing: "Bearing",
    slope: "Slope",
    land: "Land tenure",
    accuracy: "Accuracy",
    fixAge: "Updated",
    // The title when the point is the viewer's own fix.
    fixTitle: "Your position",
    // The press-and-hold sheet's title: what can go at the point.
    holdTitle: "What goes here?",
    // The one button on the tap panel that opens the verbs, and their title.
    options: "Options",
    backToPoint: "Back to this point",
    notReported: "Not reported",
    // The receiver's own height, when no terrain figure arrives for a fix.
    gpsAltitude: "GPS altitude",
    elevationChecking: "Checking…",
    // Says which of the reasons it is: a "—" opened in a gorge reads as a bug
    // rather than as the terrain being a connection away.
    elevationNeedsConnection: "Needs a connection",
    // The marker verb's subtitle once "synced" is not yet true: the phone is
    // offline, a change is still queued, or there is no account to sync to.
    markerSavedHere: "Saved on this phone",
    coordinatesCopied: "Coordinates copied.",
  },
} as const satisfies ScreenContract;

/** Location search has one placeholder on both clients. */
export const MAP_SEARCH_PLACEHOLDER = "Search places and locations";

/** The words that differ only by how each medium presses. */
export const MAP_POINT_NO_FIX_NOTE: Record<ContractPlatform, string> = {
  web: "Press the locate button to see the distance.",
  gps: "Tap the locate button to see the distance.",
};

/** The gestures a verb can be offered from: a tap asks, a hold commits. */
type VerbWhere = ContractPlatform | "both";

type PointVerbDeclaration = {
  id: string;
  icon: IconIdea;
  label: string;
  subtitle?: string;
  /**
   * Also offered straight from the press-and-hold sheet (Logjam GPS). Logjam
   * Web has no hold: a right-click opens the point panel on Options. `on` and
   * its reason or gap describe the client that has the verb at all, Options
   * included.
   */
  hold?: VerbWhere;
} & (
  | { on?: undefined; reason?: undefined }
  // Only one client has it, and `reason` says why.
  | { on: ContractPlatform; reason: string; gap?: undefined }
  // Or the other client lacks it yet, and `gap` says so.
  | { on: ContractPlatform; gap: string; reason?: undefined }
);

/** In the order each client draws them. */
export const MAP_POINT_VERBS = [
  {
    id: "navigate",
    icon: "navigateTo",
    label: "Navigate to this point",
    subtitle: "Live distance and bearing — nothing saved",
    hold: "gps",
    on: "gps",
    reason:
      "Logjam Web is used at a desk, and a browser on a desk has nowhere to navigate to. Measure from here is its stand-in: the same distance, asked once.",
  },
  {
    id: "dropMarker",
    icon: "flag",
    label: "Drop a marker here",
    subtitle: "Saved, and synced",
    hold: "gps",
    on: "gps",
    reason:
      "A marker is a quick pin with no form. Logjam Web's place form takes a name and a type, so its verb is Add a place here.",
  },
  {
    id: "drawRoute",
    icon: "draw",
    label: "Draw a route from here",
    hold: "gps",
  },
  {
    id: "addPlace",
    icon: "addPlace",
    label: "Add a place here",
    hold: "gps",
  },
  {
    id: "measure",
    icon: MAP_MEASURE_ICON,
    label: MAP_MEASURE.copy.fromHere,
    hold: "gps",
  },
  // Opens the forecast in the panel's place, and backs out to it.
  { id: "weather", icon: "weather", label: WEATHER.copy.show },
] as const satisfies readonly PointVerbDeclaration[];

/**
 * Following a route (distance left, off-route) is not built on either client,
 * and Navigate to this point is not it: that gives a live distance and bearing
 * to one point, nothing along a line. Recorded so nobody fakes it with that.
 */
export const MAP_POINT_GAPS = {
  routeFollowing: "Distance remaining and off-route warnings along a route.",
} as const;

export type MapPointVerbId = (typeof MAP_POINT_VERBS)[number]["id"];

/** The ids one client's hold draws: a `Record` over them is its parity check. */
export type MapHoldVerbId<P extends ContractPlatform> = Extract<
  (typeof MAP_POINT_VERBS)[number],
  { hold: P | "both" }
>["id"];

export type MapPointVerb = {
  id: MapPointVerbId;
  icon: IconIdea;
  label: string;
  subtitle: string | null;
};

const asVerb =
  (savedHereOnly: boolean) =>
  (verb: PointVerbDeclaration): MapPointVerb => ({
    id: verb.id as MapPointVerbId,
    icon: verb.icon,
    label: verb.label,
    subtitle:
      verb.id === "dropMarker" && savedHereOnly
        ? MAP_POINT.copy.markerSavedHere
        : (verb.subtitle ?? null),
  });

/**
 * The verbs one client's Options view has, in the order it draws them.
 * `savedHereOnly`: what a marker promises is true only once it has synced, so
 * the verb says "Saved on this phone" while that is all that is known.
 */
export function mapPointVerbs(
  platform: ContractPlatform,
  savedHereOnly = false,
): MapPointVerb[] {
  return (MAP_POINT_VERBS as readonly PointVerbDeclaration[])
    .filter((verb) => verb.on == null || verb.on === platform)
    .map(asVerb(savedHereOnly));
}

/**
 * What can go at a spot, from the gesture that commits: Logjam GPS's
 * press-and-hold sheet draws exactly these, in this order. Logjam Web's
 * right-click opens the point panel on Options instead, which has them all.
 */
export function mapHoldVerbs(
  platform: ContractPlatform,
  savedHereOnly = false,
): MapPointVerb[] {
  return (MAP_POINT_VERBS as readonly PointVerbDeclaration[])
    .filter(
      (verb) =>
        verb.hold != null && (verb.hold === "both" || verb.hold === platform),
    )
    .map(asVerb(savedHereOnly));
}

/** The point panel's layers: the facts, Options over them, the forecast over those. */
export type MapPointView = "point" | "options" | "weather";

/**
 * Where a way out goes from `view`, one layer at a time (shared/DESIGN.md §3):
 * the forecast backs out to Options, Options to the facts, and from the facts
 * there is no layer left, so null: close. Escape and the back arrow on Logjam
 * Web, the back gesture, the scrim, the swipe and the arrow on Logjam GPS.
 */
export function mapPointStepBack(view: MapPointView): MapPointView | null {
  return view === "weather" ? "options" : view === "options" ? "point" : null;
}

/** A bare lat/lng, as a map hands one back from a press. */
export type MapPointCoord = { latitude: number; longitude: number };

export type MapPointElevation =
  | { state: "known"; metres: number }
  /** The receiver's altitude, labelled as such: it is not the terrain's height. */
  | { state: "receiver"; metres: number }
  | { state: "checking" }
  | { state: "unavailable" };

export type MapPointFact = {
  key:
    | "position"
    | "elevation"
    | "accuracy"
    | "fixAge"
    | "distance"
    | "bearing"
    | "slope"
    | "land";
  label: string;
  value: string;
  /** Takes the whole line. */
  span?: true;
  /** Why there is no figure: the value is then "—" and this is its caption. */
  note?: string;
  /** Pressing the figure copies it, on both clients. */
  copyable?: true;
};

/** The position as shown and as copied: five places is under two metres. */
export function mapPointPosition(point: MapPointCoord): string {
  return `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
}

/** "12 s ago": how old a fix is, to the second while that matters. */
export function fixAgeLabel(ageMs: number): string {
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds} s ago`;
  return gaugeAgo(0, ageMs);
}

/** A position fix's own figures: the platform's timestamp and radius. */
export type MapPointFix = {
  atMs: number;
  accuracyM: number | null;
  nowMs: number;
};

/**
 * The figures for a point, in order. `from` is the viewer's own fix, or null
 * when the device has none: distance and bearing are then left out rather than
 * asked for. `slopeDegrees` is `demSlopeAt`'s answer: null or absent wherever
 * the fine DEM cannot tell, and then there is no slope figure at all. `land`
 * is the Land overlay's name for the class drawn at the point: null or absent
 * with the overlay off or nothing there, and then there is no land figure.
 */
export function mapPointFacts(input: {
  point: MapPointCoord;
  elevation: MapPointElevation;
  from: MapPointCoord | null;
  slopeDegrees?: number | null;
  land?: string | null;
  /** Given when the point IS the viewer's fix: how good and how old it is. */
  fix?: MapPointFix;
}): MapPointFact[] {
  const { point, elevation, from, slopeDegrees, land, fix } = input;
  const copy = MAP_POINT.copy;
  const facts: MapPointFact[] = [
    {
      key: "position",
      label: copy.position,
      value: mapPointPosition(point),
      span: true,
      copyable: true,
    },
    {
      key: "elevation",
      label: elevation.state === "receiver" ? copy.gpsAltitude : copy.elevation,
      value:
        elevation.state === "known" || elevation.state === "receiver"
          ? `${Math.round(elevation.metres)} m`
          : elevation.state === "checking"
            ? copy.elevationChecking
            : "—",
      ...(elevation.state === "unavailable"
        ? { note: copy.elevationNeedsConnection }
        : {}),
    },
  ];
  if (fix)
    facts.push(
      {
        key: "accuracy",
        label: copy.accuracy,
        value:
          fix.accuracyM == null
            ? copy.notReported
            : `± ${Math.round(fix.accuracyM)} m`,
      },
      {
        key: "fixAge",
        label: copy.fixAge,
        value: fixAgeLabel(fix.nowMs - fix.atMs),
      },
    );
  if (from) {
    const bearing = initialBearingDegrees(
      from.latitude,
      from.longitude,
      point.latitude,
      point.longitude,
    );
    facts.push(
      {
        key: "distance",
        label: copy.distance,
        value: formatDistanceM(
          haversineMeters(
            from.latitude,
            from.longitude,
            point.latitude,
            point.longitude,
          ),
        ),
      },
      {
        key: "bearing",
        label: copy.bearing,
        value: `${compassPointFor(bearing)} ${Math.round(bearing)}°`,
      },
    );
  }
  if (slopeDegrees != null)
    facts.push({
      key: "slope",
      label: copy.slope,
      value: `${Math.round(slopeDegrees)}°`,
    });
  if (land) facts.push({ key: "land", label: copy.land, value: land });
  return facts;
}
