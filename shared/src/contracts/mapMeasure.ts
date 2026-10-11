// THE MEASURE TOOL: points pressed onto the map, answered with how far it is
// along them and, where the terrain can be read, how much it climbs and drops.
// A toolbar over the map on Logjam GPS, a page beside it on Logjam Web
// (frontend/DESIGN.md §2).
//
// A measurement is a question, not a thing: nothing is saved, so leaving the
// tool asks nothing, and Clear is immediate. The points are the same draft the
// route tool edits (`routeDraft.ts`), so undo, drag, delete and snapping are
// the route tool's.
import { routeLengthM, type RoutePoint } from "../routeValidation.js";
import { PAIRED_STAT_LABELS } from "../statPairs.js";
import { formatDistanceM } from "../trackStats.js";
import type { IconIdea } from "../icons.js";
import type { SnapMode } from "../snapToPath.js";
import type { ContractPlatform, ScreenContract } from "./types.js";

export const MAP_MEASURE = {
  id: "map.measure",
  question: "How far is it along this line?",
  /** The tool's name: its button in the tools tray and its page's title. */
  title: "Measure distance",
  sections: [
    { key: "distance" },
    // Both read the terrain, so both are absent until it has been read:
    // offline they never arrive, and a dash would sit there looking broken.
    { key: "ascent" },
    { key: "descent" },
  ],
  copy: {
    distance: "Distance",
    ascent: PAIRED_STAT_LABELS.ascent,
    descent: PAIRED_STAT_LABELS.descent,
    readingTerrain: "Reading the terrain…",
    snap: "Snap to",
    fromHere: "Measure from here",
  },
} as const satisfies ScreenContract;

/** The glyph on the tool's button and on every verb that arms it. */
export const MAP_MEASURE_ICON: IconIdea = "measure";

/**
 * What the next segment of a drawn line follows, in the order each client lists
 * it: the measure tool's and the route tool's setting, so one set of words.
 */
export const MAP_SNAP_OPTIONS: readonly { value: SnapMode; label: string }[] = [
  { value: "off", label: "Nothing (straight lines)" },
  { value: "trails", label: "Trails" },
  { value: "waterways", label: "Creeks & rivers" },
  { value: "both", label: "Trails, creeks & rivers" },
];

/** Shown until the first point lands. Differs only by how each medium presses. */
export const MAP_MEASURE_START_NOTE: Record<ContractPlatform, string> = {
  web: "Click the map to measure",
  gps: "Tap the map to measure",
};

type MeasureVerbDeclaration = {
  id: string;
  icon: IconIdea;
  label: string;
  on?: ContractPlatform;
  reason?: string;
};

/** In the order each client draws them. */
export const MAP_MEASURE_VERBS = [
  { id: "undo", icon: "undo", label: "Undo the last change" },
  // Empties the points and stays in the tool.
  { id: "clear", icon: "delete", label: "Clear" },
  {
    id: "leave",
    icon: "delete",
    label: "Clear the measurement and close the tool",
    on: "gps",
    reason:
      "Logjam Web's tool is a page in the panel, and a page is left by the × its hero draws.",
  },
] as const satisfies readonly MeasureVerbDeclaration[];

export type MapMeasureVerbId = (typeof MAP_MEASURE_VERBS)[number]["id"];

export type MapMeasureVerb = {
  id: MapMeasureVerbId;
  icon: IconIdea;
  label: string;
};

/** The verbs one client has, in the order it draws them. */
export function mapMeasureVerbs(platform: ContractPlatform): MapMeasureVerb[] {
  return (MAP_MEASURE_VERBS as readonly MeasureVerbDeclaration[])
    .filter((verb) => verb.on == null || verb.on === platform)
    .map((verb) => ({
      id: verb.id as MapMeasureVerbId,
      icon: verb.icon,
      label: verb.label,
    }));
}

/** "1 point", "3 points": the user's own presses, never snapped filler. */
export function mapMeasurePointsLabel(anchorCount: number): string {
  return `${anchorCount} point${anchorCount === 1 ? "" : "s"}`;
}

/** What the terrain under the line said, as either client's profile holds it. */
export type MapMeasureTerrain = {
  gainM: number;
  lossM: number;
  minM: number | null;
  maxM: number | null;
};

export type MapMeasureFact = {
  key: (typeof MAP_MEASURE.sections)[number]["key"];
  label: string;
  value: string;
  /** For a screen reader, where the figure leans on an arrow. */
  spoken?: string;
};

/**
 * The figures for a measurement, in order. Distance is a dash until the line
 * has two ends; ascent and descent appear only once `terrain` has been read.
 */
export function mapMeasureFacts(input: {
  points: readonly RoutePoint[];
  terrain: MapMeasureTerrain | null;
}): MapMeasureFact[] {
  const { points, terrain } = input;
  const copy = MAP_MEASURE.copy;
  const facts: MapMeasureFact[] = [
    {
      key: "distance",
      label: copy.distance,
      value: points.length >= 2 ? formatDistanceM(routeLengthM(points)) : "—",
    },
  ];
  if (terrain) {
    const gain = Math.round(terrain.gainM);
    const loss = Math.round(terrain.lossM);
    facts.push(
      {
        key: "ascent",
        label: copy.ascent,
        value: `↑ ${gain} m`,
        spoken: `${copy.ascent} ${gain} metres`,
      },
      {
        key: "descent",
        label: copy.descent,
        value: `↓ ${loss} m`,
        spoken: `${copy.descent} ${loss} metres`,
      },
    );
  }
  return facts;
}

/** "412–655 m": the lowest and highest ground under the line, or null. */
export function mapMeasureRange(
  terrain: MapMeasureTerrain | null,
): string | null {
  if (terrain?.minM == null || terrain.maxM == null) return null;
  return `${Math.round(terrain.minM)}–${Math.round(terrain.maxM)} m`;
}
