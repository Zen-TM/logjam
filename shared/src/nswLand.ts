// The Land overlay: who holds the land, statewide, from the NSW Land Tenure
// layer. One archive built by `topo/build_land_tenure.py`, which keeps the
// source's one attribute, so a class here is the source's own word for it.
//
// It answers who holds the land, not whether anyone may go there: no dataset
// answers that, so neither a name nor a colour here says "allowed" or "no
// access", and none is red or a traffic-light green.
import { NSW_5M } from "./demSources.js";
import { rgbaCssFromHex } from "./topoSettings.js";

export const NSW_LAND = {
  /** A saved clip is filed under this, beside the area it was saved with. */
  id: "nsw-land",
  /** A PMTiles archive under the CDN's `/master`, beside the contours. */
  archivePath: "master/land/nsw-tenure.pmtiles",
  /** The build script's `SOURCE_LAYER` (test_land_tenure.py). */
  sourceLayer: "land",
  /** The source's attribute, kept as it is (test_land_tenure.py). */
  classProperty: "TenureClass",
  /** The build script's zooms: z13 is about a metre, and deeper ones overzoom. */
  minzoom: 8,
  maxzoom: 13,
  coverage: NSW_5M.coverage,
  credit:
    "Land: NSW Land Tenure, December 2024 v2 © State of New South Wales (Department of Primary Industries and Regional Development), CC BY 4.0",
  creditHtml:
    'Land: <a href="https://data.nsw.gov.au/data/dataset/nsw-land-tenure">NSW Land Tenure</a>, December 2024 v2 &copy; State of New South Wales (Department of Primary Industries and Regional Development), <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>',
} as const;

/**
 * The source's classes, in the order a legend lists them, with what a person
 * reads and their colour: solid in a legend, `landTint` on a map. `TENURE_CLASSES` in the
 * build script lists the same `source` values, and the build stops on any
 * other, because `landFillColor` leaves a class it doesn't know undrawn
 * (test_land_tenure.py).
 *
 * The source calls "Aboriginal Area" "Indigenous Owned", but all it holds there
 * are NPWS reserves of that type; Land Council freehold can be under Private.
 */
export const LAND_CLASSES = [
  { source: "Private", name: "Private land", colour: "#8e6bbf" },
  { source: "National Park", name: "National park", colour: "#2f9c95" },
  { source: "State Forest", name: "State forest", colour: "#7f8f3a" },
  {
    source: "Crownland-Leasehold",
    name: "Crown leasehold",
    colour: "#d9a441",
  },
  { source: "Crownland-Other", name: "Crown land", colour: "#e6d34f" },
  { source: "Indigenous Owned", name: "Aboriginal Area", colour: "#3b78c4" },
  {
    source: "Unresolved Tenure",
    name: "Tenure unresolved",
    colour: "#8a8a8a",
  },
] as const;

/** A class's colour on a map, translucent so the map stays readable under it. */
export const landTint = ({ colour }: { colour: string }): string =>
  rgbaCssFromHex(`${colour}4d`);

/** The MapLibre `fill-color` expression both clients tint the land with. */
export function landFillColor(): unknown[] {
  return [
    "match",
    ["get", NSW_LAND.classProperty],
    ...LAND_CLASSES.flatMap((c) => [c.source, landTint(c)]),
    "rgba(0,0,0,0)",
  ];
}

/** A feature's class, from its `classProperty`, or undefined if it is no class. */
export function landClass(value: unknown) {
  return LAND_CLASSES.find((c) => c.source === value);
}

/**
 * The name "What is here?" gives the land at a point, from what a map's own
 * query found on its land layer there, or null. Neither client asks anyone
 * else: a tap reads the tile already on the device.
 */
export function landNameOf(
  features: readonly { properties?: Record<string, unknown> | null }[],
): string | null {
  return (
    landClass(features[0]?.properties?.[NSW_LAND.classProperty])?.name ?? null
  );
}
