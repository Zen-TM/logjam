// The Coverage overlay: where the user's carrier predicts a phone won't work,
// statewide, from the ACCC Mobile Infrastructure Report data. One archive,
// rebuilt by `topo/build_coverage.py` when the ACCC publishes a new year,
// holds every carrier: each area is a carrier's `level` there, and the map
// draws only the user's carrier.
//
// It hatches where there is no mobile reception and draws nothing where a
// phone in the hand should work: a fill over the whole state would hide Slope
// and Land.
import { COVERAGE_HATCH_URI } from "./coverageHatchImages.js";
import { MAP_TERRAIN } from "./contracts/mapTerrain.js";
import { NSW_5M } from "./demSources.js";

export const NSW_COVERAGE = {
  /** A saved clip is filed under this, beside the area it was saved with. */
  id: "nsw-coverage",
  /** A PMTiles archive under the CDN's `/master`, beside Land. */
  archivePath: "master/coverage/nsw-coverage.pmtiles",
  /** The build script's `SOURCE_LAYER` (test_coverage.py). */
  sourceLayer: "coverage",
  /** A `CARRIERS` id. */
  carrierProperty: "carrier",
  /** A `COVERAGE_LEVELS` level. */
  levelProperty: "level",
  /** The build script's zooms: z12 alone, where the overlay is drawn from
   *  (`COVERAGE_MIN_ZOOM`); its grid is about 50 m, finer than z12's pixels.
   *  Deeper zooms overzoom. */
  minzoom: 12,
  maxzoom: 12,
  coverage: NSW_5M.coverage,
  credit:
    "Mobile coverage: ACCC Mobile Infrastructure Report data release © Commonwealth of Australia (ACCC), CC BY 2.5 AU; coastline © ABS, CC BY 4.0",
  creditHtml:
    'Mobile coverage: <a href="https://data.gov.au/data/dataset/accc-mobile-infrastructure-report-data-release">ACCC Mobile Infrastructure Report data release</a> &copy; Commonwealth of Australia (ACCC), <a href="https://creativecommons.org/licenses/by/2.5/au/">CC BY 2.5 AU</a>; coastline &copy; <a href="https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs-edition-3">ABS</a>, <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>',
} as const;

/**
 * The networks a user picks from: the three that own one. `NETWORKS` in the
 * build script has the same ids (test_coverage.py). A reseller uses one of
 * these; Telstra's resellers get less than Telstra's own map, which the legend
 * says.
 */
export const CARRIERS = [
  { id: "telstra", name: "Telstra" },
  { id: "optus", name: "Optus" },
  { id: "tpg", name: "TPG" },
] as const;

export type CarrierId = (typeof CARRIERS)[number]["id"];

/** A stored carrier, or null for anything that isn't one: until the user
 *  picks, the overlay has no carrier and draws nothing. */
export function normalizeCarrier(value: unknown): CarrierId | null {
  return CARRIERS.find((c) => c.id === value)?.id ?? null;
}

/** The style image's name, registered on each map with `COVERAGE_HATCH_URIS`. */
export const COVERAGE_HATCH_IMAGE = "coverage-hatch";

export const COVERAGE_HATCH_URIS = {
  [COVERAGE_HATCH_IMAGE]: COVERAGE_HATCH_URI,
} as const;

/** The hatch is drawn at 2x (generate-coverage-hatch-images.mjs). */
export const COVERAGE_HATCH_PIXEL_RATIO = 2;

/**
 * The archive's levels, best first. `LEVELS` in the build script lists the
 * same `level`s (test_coverage.py). Only a handset outdoors is mobile
 * reception: the overlay is for a phone in the hand, and a place an external
 * antenna alone reaches has none for it.
 */
export const COVERAGE_LEVELS = ["outdoor", "external", "none"] as const;
export const RECEPTION_LEVEL = COVERAGE_LEVELS[0];

/**
 * Whether the overlay is drawn: switched on, with a carrier picked. Before a
 * pick there is no network to draw, so a stored "on" draws nothing. Both
 * clients gate the layer on this.
 */
export function drawsCoverage(on: boolean, carrier: CarrierId | null): boolean {
  return on && carrier !== null;
}

/** The layer's `filter`: the user's carrier alone. */
export function coverageFilter(carrier: CarrierId): unknown[] {
  return ["==", ["get", NSW_COVERAGE.carrierProperty], carrier];
}

/**
 * The `fill-opacity` expression: clear where there is reception, so the area
 * is still there for a tap to read, and hatched everywhere else.
 */
export function coverageOpacity(): unknown[] {
  return ["match", ["get", NSW_COVERAGE.levelProperty], RECEPTION_LEVEL, 0, 1];
}

/**
 * "Telstra: no mobile reception": what "What is here?" says of the levels a
 * map's own query found on its coverage layer at a point, or null. The layer
 * is filtered to one carrier, so any feature found is that carrier's. On the
 * line between two levels any without reception wins: the map hatches the
 * spot, since a clear fill over a hatch hides nothing.
 */
export function coverageNameOf(
  features: readonly { properties?: Record<string, unknown> | null }[],
  carrier: CarrierId,
): string | null {
  const levels = features.map(
    (f) => f.properties?.[NSW_COVERAGE.levelProperty],
  );
  const known = levels.filter((l) =>
    (COVERAGE_LEVELS as readonly unknown[]).includes(l),
  );
  if (known.length === 0) return null;
  const name = CARRIERS.find((c) => c.id === carrier)?.name ?? carrier;
  const copy = MAP_TERRAIN.copy;
  return `${name}: ${
    known.every((l) => l === RECEPTION_LEVEL)
      ? copy.coverageReception
      : copy.coverageNoReception
  }`;
}
