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
import { FLOW_NETWORK_SNAP_M, type FlowNetworkLookup } from "../flowNetwork.js";
import { MAP_MEASURE, MAP_MEASURE_ICON } from "./mapMeasure.js";
import type { ContractPlatform, ScreenContract } from "./types.js";

const FLOW_NETWORK_GAP =
  "Logjam GPS's sheet does not ask the API's flow network yet: a gap, not a choice.";

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
    {
      key: "slope",
      on: "gps",
      reason:
        "A slope needs nine heights from the fine DEM. Logjam GPS reads DEM tiles itself; Logjam Web gets heights from the API's profile route, which answers along a line.",
    },
    // How much land drains through the nearest creek: a measurement of the
    // ground, never a rating of how dangerous the creek is.
    { key: "catchment", on: "web", reason: FLOW_NETWORK_GAP },
  ],
  copy: {
    position: "Position",
    elevation: "Elevation",
    distance: "Distance",
    bearing: "Bearing",
    slope: "Slope",
    elevationChecking: "Checking…",
    // Says which of the reasons it is: a "—" opened in a gorge reads as a bug
    // rather than as the terrain being a connection away.
    elevationNeedsConnection: "Needs a connection",
    coordinatesCopied: "Coordinates copied.",
    catchment: "Catchment",
    catchmentChecking: "Checking…",
    catchmentNoCreek: `No creek within ${FLOW_NETWORK_SNAP_M} m`,
    // The layer is built basin by basin, so "none here" would be false.
    catchmentNotCovered: "Not covered yet",
    catchmentFailed: "Couldn't check the catchment.",
    upstreamFinding: "Finding the creeks upstream…",
    upstreamFailed: "Couldn't show the creeks upstream.",
    upstreamClear: "Clear the creeks upstream",
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
  /** Offered only once a creek has been found near the point. */
  needsCreek?: true;
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
      "Logjam Web is used at a desk, and a browser on a desk has nowhere to navigate to. Measure from here is its stand-in: the same distance, asked once.",
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
    id: "measure",
    icon: MAP_MEASURE_ICON,
    label: MAP_MEASURE.copy.fromHere,
    on: "web",
    reason:
      "On Logjam GPS the same words are on the press-and-hold sheet, beside Navigate here.",
  },
  {
    id: "copy",
    icon: "copy",
    label: "Copy coordinates",
    on: "web",
    reason:
      "Logjam GPS copies by pressing the Position figure, which wears the copy glyph.",
  },
  {
    id: "upstream",
    icon: "catchment",
    label: "Show the creeks upstream",
    on: "web",
    reason: FLOW_NETWORK_GAP,
    needsCreek: true,
  },
] as const satisfies readonly PointVerbDeclaration[];

export type MapPointVerbId = (typeof MAP_POINT_VERBS)[number]["id"];

export type MapPointVerb = {
  id: MapPointVerbId;
  icon: IconIdea;
  label: string;
  subtitle: string | null;
};

/**
 * The verbs one client has, in the order it draws them. `creekFound`: the
 * catchment lookup found a creek near the point; until then (and when it
 * found none) there is nothing upstream to show.
 */
export function mapPointVerbs(
  platform: ContractPlatform,
  { creekFound = false }: { creekFound?: boolean } = {},
): MapPointVerb[] {
  return (MAP_POINT_VERBS as readonly PointVerbDeclaration[])
    .filter((verb) => verb.on === platform && (creekFound || !verb.needsCreek))
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

/**
 * What the flow network says about the creek nearest the point. `failed`
 * carries the sentence `messageFromError` chose: the API's own, as it is.
 */
export type MapPointCatchment =
  | { state: "checking" }
  | { state: "found"; catchmentKm2: number; biggerNearbyKm2: number | null }
  | { state: "noCreek" }
  | { state: "notCovered" }
  | { state: "failed"; message: string };

/** A lookup's answer, as the panel shows it. */
export function mapPointCatchment(
  lookup: FlowNetworkLookup,
): MapPointCatchment {
  switch (lookup.status) {
    case "found":
      return {
        state: "found",
        catchmentKm2: lookup.catchmentKm2,
        biggerNearbyKm2: lookup.biggerNearby?.catchmentKm2 ?? null,
      };
    case "no-creek":
      return { state: "noCreek" };
    case "not-covered":
      return { state: "notCovered" };
  }
}

/**
 * An area in km², at a precision that suits it: a gully's 0.03 km² and a
 * river's 663 km² both show. Always km², so two catchments on one surface
 * compare at a glance (shared/DESIGN.md §11).
 */
export function formatCatchmentKm2(km2: number): string {
  if (!Number.isFinite(km2) || km2 < 0) return "—";
  if (km2 < 0.005) return "<0.01 km²";
  // Thresholds at the rounding edge, so 0.996 reads "1.0", not "1.00".
  const digits = km2 < 0.995 ? 2 : km2 < 9.95 ? 1 : 0;
  const figure = km2.toLocaleString("en-AU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${figure} km²`;
}

/**
 * The line under the figures when a much bigger creek is also in range: near
 * a confluence the nearest creek may not be the one the user meant.
 */
export function mapPointCatchmentNote(
  catchment: MapPointCatchment | undefined,
): string | null {
  if (catchment?.state !== "found" || catchment.biggerNearbyKm2 == null)
    return null;
  return `A creek draining ${formatCatchmentKm2(catchment.biggerNearbyKm2)} is also nearby.`;
}

/**
 * The notice over the map while the creeks upstream of a point are drawn.
 * `trimmed`: the API left the smallest creeks out to fit the response.
 */
export function mapPointUpstreamNotice(
  catchmentKm2: number,
  trimmed: boolean,
): string {
  const line = `Creeks upstream · ${formatCatchmentKm2(catchmentKm2)}`;
  return trimmed ? `${line} · smaller ones left out` : line;
}

export type MapPointFact = {
  key:
    | "position"
    | "elevation"
    | "distance"
    | "bearing"
    | "slope"
    | "catchment";
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
 * asked for. `slopeDegrees` is `demSlopeAt`'s answer: null or absent wherever
 * the fine DEM cannot tell, and then there is no slope figure at all.
 * `catchment` is absent on a client that does not look it up.
 */
export function mapPointFacts(input: {
  point: MapPointCoord;
  elevation: MapPointElevation;
  from: MapPointCoord | null;
  slopeDegrees?: number | null;
  catchment?: MapPointCatchment;
}): MapPointFact[] {
  const { point, elevation, from, slopeDegrees, catchment } = input;
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
  if (slopeDegrees != null)
    facts.push({
      key: "slope",
      label: copy.slope,
      value: `${Math.round(slopeDegrees)}°`,
    });
  if (catchment)
    facts.push({
      key: "catchment",
      label: copy.catchment,
      ...(catchment.state === "failed"
        ? // A sentence, not a figure: it takes the line.
          { value: catchment.message, span: true as const }
        : {
            value:
              catchment.state === "found"
                ? formatCatchmentKm2(catchment.catchmentKm2)
                : catchment.state === "checking"
                  ? copy.catchmentChecking
                  : catchment.state === "noCreek"
                    ? copy.catchmentNoCreek
                    : copy.catchmentNotCovered,
          }),
    });
  return facts;
}
