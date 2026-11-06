// The Fire history overlay: how long since the ground last burnt, statewide,
// from NPWS Fire History. One archive, rebuilt each month by
// `topo/build_fire_history.py` from the same read as the vegetation layer's
// fire raster, holds each area once, with its most recent fire: a newer fire
// is cut out of every older one, so the tint never adds up where fires overlap.
//
// The archive holds the fire's year and month, never how long ago that was:
// each client works that out from today, so the map doesn't age between builds.
import { NSW_5M } from "./demSources.js";

export const NSW_FIRE = {
  /** A saved clip is filed under this, beside the area it was saved with. */
  id: "nsw-fire",
  /** A PMTiles archive under the CDN's `/master`, beside Land. */
  archivePath: "master/fire/nsw-fire-history.pmtiles",
  /** The build script's `OVERLAY_LAYER` (test_fire_overlay.py). */
  sourceLayer: "fire",
  /** The fire's year and month (1 to 12), from its end date, or its start
   *  date while it has none: the vegetation layer's rule. */
  yearProperty: "year",
  monthProperty: "month",
  /** The source's `FireType` code, absent where it had none: `FIRE_TYPES`. */
  typeProperty: "type",
  /** The build script's zooms: fires are mapped to tens of metres, and z12 is
   *  finer than that. Deeper zooms overzoom. */
  minzoom: 8,
  maxzoom: 12,
  coverage: NSW_5M.coverage,
  credit:
    "Fire history © State Government of NSW and NSW Department of Climate Change, Energy, the Environment and Water 2010 — NPWS Fire History - Wildfires and Prescribed Burns (CC BY 4.0)",
  creditHtml:
    'Fire history &copy; State Government of NSW and NSW Department of Climate Change, Energy, the Environment and Water 2010 — <a href="https://datasets.seed.nsw.gov.au/dataset/fire-history-wildfires-and-prescribed-burns-1e8b6">NPWS Fire History - Wildfires and Prescribed Burns</a> (<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>)',
} as const;

/**
 * The source's `FireType` codes, as "What is here?" names them. A code not
 * listed reads as `FIRE_UNKNOWN_TYPE`, so a new one still shows its date.
 */
export const FIRE_TYPES: Readonly<Record<number, string>> = {
  1: "Wildfire",
  2: "Prescribed burn",
};
const FIRE_UNKNOWN_TYPE = "Fire";

/**
 * The tint by years since the area last burnt, as stops a map interpolates
 * between: darkest within the year, gone by ten, and nothing for an older
 * fire. `fill` is the tint's opacity and `edge` a 1 px line's in the same
 * colour, which keeps a burn's boundary readable over the slope colours.
 *
 * A pink-crimson, not a fire's orange or red: Slope's default bands run yellow,
 * orange, red and dark red, and Land's edges are purple, teal, olive, gold,
 * yellow, blue and grey. Guard: `nswFire.test.ts`.
 */
export const FIRE_RAMP = [
  { years: 1, colour: "#be185d", fill: 0.45, edge: 0.9 },
  { years: 4, colour: "#db2777", fill: 0.3, edge: 0.7 },
  { years: 10, colour: "#ec4899", fill: 0, edge: 0 },
] as const;

/** Whole months from the fire's month to `now`'s, in the device's own time. */
function monthsSinceExpression(now: Date): unknown[] {
  return [
    "-",
    now.getFullYear() * 12 + now.getMonth() + 1,
    [
      "+",
      ["*", 12, ["get", NSW_FIRE.yearProperty]],
      ["get", NSW_FIRE.monthProperty],
    ],
  ];
}

function rampExpression(
  now: Date,
  value: (stop: (typeof FIRE_RAMP)[number]) => string | number,
): unknown[] {
  return [
    "interpolate",
    ["linear"],
    ["/", monthsSinceExpression(now), 12],
    ...FIRE_RAMP.flatMap((stop) => [stop.years, value(stop)]),
  ];
}

/** The fill's `fill-color`, as of `now`. */
export function fireColor(now: Date): unknown[] {
  return rampExpression(now, (stop) => stop.colour);
}

/** The fill's `fill-opacity`, as of `now`. */
export function fireFillOpacity(now: Date): unknown[] {
  return rampExpression(now, (stop) => stop.fill);
}

/** The edge's `line-opacity`, as of `now`. */
export function fireEdgeOpacity(now: Date): unknown[] {
  return rampExpression(now, (stop) => stop.edge);
}

/**
 * What the ramp draws `years` after a fire: the expressions' own rule, for a
 * legend swatch. Before the first stop it holds the first; past the last, the
 * last (nothing). Guard: `nswFire.test.ts`, against the expressions.
 */
export function fireTintAt(years: number): {
  colour: string;
  fill: number;
  edge: number;
} {
  const first = FIRE_RAMP[0];
  const last = FIRE_RAMP[FIRE_RAMP.length - 1]!;
  if (years <= first.years) return { ...first };
  if (years >= last.years) return { ...last };
  const at = FIRE_RAMP.findIndex((stop) => stop.years > years);
  const a = FIRE_RAMP[at - 1]!;
  const b = FIRE_RAMP[at]!;
  const t = (years - a.years) / (b.years - a.years);
  const mix = (x: number, y: number) => x + (y - x) * t;
  return {
    colour: mixHex(a.colour, b.colour, t),
    fill: mix(a.fill, b.fill),
    edge: mix(a.edge, b.edge),
  };
}

/** `from` moved `t` of the way to `to`, per channel, as `#rrggbb`. */
function mixHex(from: string, to: string, t: number): string {
  const channel = (hex: string, i: number) =>
    parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2]
    .map((i) =>
      Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/**
 * The legend: a swatch for each row as the tint shows on a white map, newest
 * first. Opaque, since a legend sits on a sheet, not the map: a dark sheet
 * would swallow a translucent swatch. Ten years and more has no row: it has
 * no colour, as the legend says.
 */
export function fireLegendRows(): { label: string; colour: string }[] {
  return [
    { label: "Under a year ago", years: 0 },
    { label: "4 years ago", years: 4 },
    { label: "7 years ago", years: 7 },
  ].map(({ label, years }) => {
    const { colour, fill } = fireTintAt(years);
    return { label, colour: mixHex("#ffffff", colour, fill) };
  });
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * "Wildfire, Dec 2019": what "What is here?" says of the most recent fire a
 * map's own query found on its fire layer at a point, or null. Neither client
 * asks anyone else: a tap reads the tile already on the device. A tap can find
 * one area twice (from two tiles' margins), so the newest found wins.
 */
export function fireNameOf(
  features: readonly { properties?: Record<string, unknown> | null }[],
): string | null {
  let best: { year: number; month: number; type: unknown } | null = null;
  for (const feature of features) {
    const p = feature.properties ?? {};
    const year = p[NSW_FIRE.yearProperty];
    const month = p[NSW_FIRE.monthProperty];
    if (typeof year !== "number" || typeof month !== "number") continue;
    if (month < 1 || month > 12) continue;
    if (best && year * 12 + month <= best.year * 12 + best.month) continue;
    best = { year, month, type: p[NSW_FIRE.typeProperty] };
  }
  if (!best) return null;
  const type =
    (typeof best.type === "number" ? FIRE_TYPES[best.type] : undefined) ??
    FIRE_UNKNOWN_TYPE;
  return `${type}, ${MONTHS[best.month - 1]} ${best.year}`;
}
