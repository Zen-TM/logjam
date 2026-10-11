// "WHAT IS HERE?": the small panel a press on empty map opens — a sheet on
// Logjam GPS's map, a popover anchored at the point on Logjam Web's. The map
// answers where things are; this answers what a spot you are only pointing at
// is: where it is, how high, and (with a fix) how far and which way from you,
// then the few things worth doing about it.
//
// The facts are one declaration both clients draw (`mapPointFacts`); the verbs
// are declared once with the client that has each. A tap asks and a
// press-and-hold commits (shared/DESIGN.md §3): this is the asking, so its
// verbs are the first steps of something, never a write that cannot be undone
// without a trip to another screen.
//
// PRIVACY (shared/DESIGN.md §13): a coordinate and a distance-from-me belong on
// a DETAIL surface, which is what this is: the user asked about this exact
// spot. Nothing here is logged, toasted or persisted; the point lives in the
// map's state until the panel is dismissed.
import { haversineMeters } from "../placeGeo.js";
import {
  compassPointFor,
  formatDistanceM,
  initialBearingDegrees,
} from "../trackStats.js";
import type { IconIdea } from "../icons.js";
import type { ContractPlatform, ScreenContract } from "./types.js";

export const MAP_POINT = {
  id: "map.point",
  question: "What is at this spot?",
  title: "This point",
  sections: [
    { key: "position" },
    { key: "elevation" },
    // Both need a location fix the device ALREADY has: neither client asks for
    // one to show them.
    { key: "distance" },
    { key: "bearing" },
  ],
  copy: {
    position: "Position",
    elevation: "Elevation",
    distance: "Distance",
    bearing: "Bearing",
    elevationChecking: "Checking…",
    // Says which of the reasons it is: a "—" opened in a gorge reads as a bug
    // rather than as the terrain being a connection away.
    elevationNeedsConnection: "Needs a connection",
    coordinatesCopied: "Coordinates copied.",
  },
} as const satisfies ScreenContract;

/** The words that differ only by how each medium presses. */
export const MAP_POINT_NO_FIX_NOTE: Record<ContractPlatform, string> = {
  web: "Press the locate button to see the distance.",
  gps: "Tap the locate button to see the distance.",
};

type PointVerbDeclaration = {
  id: string;
  icon: IconIdea;
  label: string;
  subtitle?: string;
  on: ContractPlatform;
  reason: string;
};

/** In the order each client draws them. */
export const MAP_POINT_VERBS = [
  {
    id: "navigate",
    icon: "navigateTo",
    label: "Navigate to this point",
    subtitle: "Live distance and bearing — nothing saved",
    on: "gps",
    reason:
      "Logjam Web is where a trip is planned, not walked: it has no live navigation to start.",
  },
  {
    id: "dropMarker",
    icon: "flag",
    label: "Drop a marker here",
    subtitle: "Saved, and synced",
    on: "gps",
    reason:
      "A marker is a quick pin with no form. Logjam Web's place form takes a name and a type, so its verb is Add a place here.",
  },
  {
    id: "addPlace",
    icon: "addPlace",
    label: "Add a place here",
    on: "web",
    reason:
      "Logjam GPS puts a place here from a press-and-hold, and drops a marker from this sheet.",
  },
  {
    id: "drawRoute",
    icon: "draw",
    label: "Draw a route from here",
    on: "web",
    reason:
      "On Logjam GPS the same words are on the press-and-hold sheet, which is where a thing is put on the map.",
  },
  {
    id: "copy",
    icon: "copy",
    label: "Copy coordinates",
    on: "web",
    reason:
      "Logjam GPS copies by pressing the Position figure, which wears the copy glyph.",
  },
] as const satisfies readonly PointVerbDeclaration[];

export type MapPointVerbId = (typeof MAP_POINT_VERBS)[number]["id"];

export type MapPointVerb = {
  id: MapPointVerbId;
  icon: IconIdea;
  label: string;
  subtitle: string | null;
};

/** The verbs one client has, in the order it draws them. */
export function mapPointVerbs(platform: ContractPlatform): MapPointVerb[] {
  return (MAP_POINT_VERBS as readonly PointVerbDeclaration[])
    .filter((verb) => verb.on === platform)
    .map((verb) => ({
      id: verb.id as MapPointVerbId,
      icon: verb.icon,
      label: verb.label,
      subtitle: verb.subtitle ?? null,
    }));
}

/** A bare lat/lng, as a map hands one back from a press. */
export type MapPointCoord = { latitude: number; longitude: number };

export type MapPointElevation =
  | { state: "known"; metres: number }
  | { state: "checking" }
  | { state: "unavailable" };

export type MapPointFact = {
  key: "position" | "elevation" | "distance" | "bearing";
  label: string;
  value: string;
  /** Takes the whole line. */
  span?: true;
  /** Pressing the figure copies it (Logjam GPS); Logjam Web has a verb. */
  copyable?: true;
};

/** The position as shown and as copied: five places is under two metres. */
export function mapPointPosition(point: MapPointCoord): string {
  return `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
}

/**
 * The figures for a point, in order. `from` is the viewer's own fix, or null
 * when the device has none: distance and bearing are then left out rather than
 * asked for.
 */
export function mapPointFacts(input: {
  point: MapPointCoord;
  elevation: MapPointElevation;
  from: MapPointCoord | null;
}): MapPointFact[] {
  const { point, elevation, from } = input;
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
      label: copy.elevation,
      value:
        elevation.state === "known"
          ? `${Math.round(elevation.metres)} m`
          : elevation.state === "checking"
            ? copy.elevationChecking
            : copy.elevationNeedsConnection,
    },
  ];
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
  return facts;
}
