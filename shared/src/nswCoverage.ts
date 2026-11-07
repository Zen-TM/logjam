// The Coverage overlay: where the user's carrier predicts a phone won't work,
// statewide, from the ACCC Mobile Infrastructure Report data. One archive,
// rebuilt by `topo/build_coverage.py` when the ACCC publishes a new year,
// holds every carrier: each area is a carrier's `level` there, and the map
// draws only the user's carrier.
//
// It hatches the gaps and draws nothing where a phone in the hand should
// work: a fill over the whole state would hide Slope and Land.
import {
  COVERAGE_HATCH_DENSE_URI,
  COVERAGE_HATCH_LIGHT_URI,
} from "./coverageHatchImages.js";
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
  /** The build script's zooms: its grid is about 50 m, finer than z12's
   *  pixels. Deeper zooms overzoom. */
  minzoom: 8,
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

/** The network most of the state's coverage is on, until the user picks. */
export const DEFAULT_CARRIER: CarrierId = "telstra";

/** A stored carrier, or the default for anything that isn't one. */
export function normalizeCarrier(value: unknown): CarrierId {
  return CARRIERS.find((c) => c.id === value)?.id ?? DEFAULT_CARRIER;
}

/** Style-image names, registered on each map with `COVERAGE_HATCH_URIS`. */
export const COVERAGE_HATCH_LIGHT_IMAGE = "coverage-hatch-light";
export const COVERAGE_HATCH_DENSE_IMAGE = "coverage-hatch-dense";

export const COVERAGE_HATCH_URIS = {
  [COVERAGE_HATCH_LIGHT_IMAGE]: COVERAGE_HATCH_LIGHT_URI,
  [COVERAGE_HATCH_DENSE_IMAGE]: COVERAGE_HATCH_DENSE_URI,
} as const;

/** The hatches are drawn at 2x (generate-coverage-hatch-images.mjs). */
export const COVERAGE_HATCH_PIXEL_RATIO = 2;

/**
 * The archive's levels, best first, as "What is here?" names them and the
 * hatch each draws. `LEVELS` in the build script lists the same `level`s
 * (test_coverage.py).
 */
export const COVERAGE_LEVELS = [
  { level: "outdoor", name: "handset outdoors", hatch: null },
  {
    level: "external",
    name: "external antenna only",
    hatch: COVERAGE_HATCH_LIGHT_IMAGE,
  },
  {
    level: "none",
    name: "no predicted coverage",
    hatch: COVERAGE_HATCH_DENSE_IMAGE,
  },
] as const;

/** The layer's `filter`: the user's carrier alone. */
export function coverageFilter(carrier: CarrierId): unknown[] {
  return ["==", ["get", NSW_COVERAGE.carrierProperty], carrier];
}

const hatched = COVERAGE_LEVELS.filter((l) => l.hatch !== null);

/** The `fill-pattern` expression: each gap's hatch. */
export function coveragePattern(): unknown[] {
  return [
    "match",
    ["get", NSW_COVERAGE.levelProperty],
    ...hatched.flatMap((l) => [l.level, l.hatch]),
    COVERAGE_HATCH_LIGHT_IMAGE,
  ];
}

/**
 * The `fill-opacity` expression: clear where a handset works, so the area is
 * still there for a tap to read, and drawn nowhere.
 */
export function coverageOpacity(): unknown[] {
  return [
    "match",
    ["get", NSW_COVERAGE.levelProperty],
    hatched.map((l) => l.level),
    1,
    0,
  ];
}

/**
 * "Telstra: external antenna only": what "What is here?" says of the level a
 * map's own query found on its coverage layer at a point, or null. The layer
 * is filtered to one carrier, so any feature found is that carrier's; a tap
 * that finds two levels (on the line between them, from two tiles' margins)
 * gives the worse, which is the safer one to plan on.
 */
export function coverageNameOf(
  features: readonly { properties?: Record<string, unknown> | null }[],
  carrier: CarrierId,
): string | null {
  let worst = -1;
  for (const feature of features) {
    const at = COVERAGE_LEVELS.findIndex(
      (l) => l.level === feature.properties?.[NSW_COVERAGE.levelProperty],
    );
    worst = Math.max(worst, at);
  }
  if (worst < 0) return null;
  const name = CARRIERS.find((c) => c.id === carrier)?.name ?? carrier;
  return `${name}: ${COVERAGE_LEVELS[worst]!.name}`;
}
