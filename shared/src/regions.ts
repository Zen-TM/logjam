// The regions Logjam has maps, terrain and a canyon list for, and the one
// declaration each client, the API and topo/ read them from. NSW is the first.
//
// What a map offers follows the ground it shows: a layer, a basemap or a grid
// is offered where its data covers the view, and the regions an account chose
// (`uiPreferences.regions`) only set defaults: where a map first opens, the
// first-run basemap, the canyon-list offers (ADR 0049). `regionInView` is the
// question a map is to ask and `regionsTouching` the one for a box that is
// saved, printed or exported; the basemap gallery asks them through
// `offeredBasemaps` and `basemapHere` (geoPdfBaseLayers.ts). Heights, gauges and the area-export check never took a
// choice: they follow coverage (ADR 0028 for heights). Worldwide sources
// (TERRARIUM, the OSM rasters, Open-Meteo) belong to no region. Guarded for
// heights and the area-export check: `regions.test.ts` (`DEM_SOURCES` holds
// every region's sources) and `areaExport.test.ts` (the check reads every
// region with terrain).
//
// Stored ids and paths keep their values: `nsw-5m`, `six-*`,
// `master/dem/nsw-5m.pmtiles`, `master/places/v1/` and `master/gauges/v1/` are
// on phones, in tracks' climb labels and in installed builds. A new region's
// archives go under `master/<kind>/<region>-…`, as NSW's terrain already does.
// Guard: `regions.test.ts` ("keeps NSW's stored ids and paths").
import type { DemSource } from "./demSources.js";
import { GAUGE_PREFIX } from "./gauges.js";
import { SYDNEY_TZ } from "./monthlyQuota.js";
import { matchOzUltimateUrl } from "./ozUltimate.js";
import { PLACE_REGISTRY_PREFIX } from "./placeRegistry.js";

import { SIM_REGIONS, SIM_WORLD } from "./simRegions.js";

/** One closed outline of [lon, lat]; the last vertex joins the first. */
export type Ring = readonly (readonly [lon: number, lat: number])[];

/**
 * Measured bytes of one stored tile at each zoom an archive holds: what an
 * offline save of it costs (`planRegionForBasemaps`). Guard:
 * `mapRegionEstimate.test.ts` ("holds figures for every zoom a save clips").
 */
export type TileBytes = Readonly<
  Record<number, { meanBytes: number; p90Bytes: number }>
>;

/** A layer archive Logjam builds and serves under the CDN's `/master`. */
export type TerrainArchive = {
  /** A saved clip is filed under this, beside the area it was saved with. */
  id: string;
  archivePath: string;
  minzoom: number;
  maxzoom: number;
  coverage: readonly [number, number, number, number];
  credit: string;
  creditHtml: string;
  tileBytes: TileBytes;
};

/** The height source the other archives are cut from; one of the region's `dem`. */
export type HeightsArchive = DemSource & {
  archivePath: string;
  coverage: TerrainArchive["coverage"];
  tileBytes: TileBytes;
};
export type LandArchive = TerrainArchive & {
  sourceLayer: string;
  /** The tile attribute that holds a feature's class: one of `classes`' `source`. */
  classProperty: string;
  /**
   * The source's classes, in the order a legend lists them, each with what a
   * person reads and its colour. A class not listed is left undrawn.
   */
  classes: readonly [
    { source: string; name: string; colour: string },
    ...{ source: string; name: string; colour: string }[],
  ];
  /** What the source gets wrong, said beside the legend it qualifies. */
  caveat: string;
};
export type FireArchive = TerrainArchive & {
  sourceLayer: string;
  yearProperty: string;
  monthProperty: string;
  typeProperty: string;
  /** The source's fire-type codes, as "What is here?" names them. */
  types: Readonly<Record<number, string>>;
  /** What the source gets wrong, said beside the legend it qualifies. */
  caveat: string;
};
export type CoverageArchive = TerrainArchive & {
  sourceLayer: string;
  carrierProperty: string;
  levelProperty: string;
  /** The networks a user picks from; `id` is the `carrierProperty` value. */
  carriers: readonly [
    { id: string; name: string },
    ...{ id: string; name: string }[],
  ];
  /** What the source gets wrong, said beside the legend it qualifies. */
  caveat: string;
};

/** The Terrain group's archives. A member a region lacks is absent: `layerIn` is null. */
export type RegionTerrain = {
  heights?: HeightsArchive;
  slope?: TerrainArchive;
  hillshade?: TerrainArchive;
  contours?: TerrainArchive;
  land?: LandArchive;
  fire?: FireArchive;
  coverage?: CoverageArchive;
};

export type Region = {
  /**
   * Stored in `uiPreferences.regions`: never change one. Lower-case letters
   * and digits only: a map's layer ids are `${id}${layer}`. Guards:
   * `regions.test.ts` ("keeps NSW's stored ids and paths", "keeps each id to
   * lower-case letters and digits").
   */
  id: string;
  /** What user copy calls it: "That area is outside NSW". */
  name: string;
  /** Where a map opens before the user has moved it. */
  view: { center: readonly [lon: number, lat: number]; zoom: number };
  /** IANA. The leaderboard's season and a trip plan's day read it; gauge days still read `SYDNEY_TZ`. */
  timeZone: string;
  /**
   * The border, simplified, as one ring of [lon, lat] for each island, drawn a
   * little outside the real one so it never cuts off ground the region's data
   * covers. A box would not do: neighbouring countries' boxes overlap. `WORLD`
   * has none.
   */
  borders: readonly Ring[];
  /** Ids in `BASEMAP_CATALOG`, each in one region at most (regions.test.ts). */
  basemaps: readonly string[];
  /** The one a map opens on before the user picks; one of `basemaps`. */
  defaultBasemap: string;
  /** The region's cut of the vector basemap, or null where it has none. */
  vector: { archivePath: string; maxzoom: number } | null;
  /** Height sources, finest first. `DEM_SOURCES` is every region's, then the worldwide one. */
  dem: readonly DemSource[];
  /** The Terrain group's archives; `{}` where a region has none. */
  terrain: RegionTerrain;
  /** The CDN prefix of the place-search registry (ADR 0034), or null. */
  placeSearch: string | null;
  /** The CDN prefix of the gauge feed (ADR 0044), or null. */
  gauges: string | null;
  /** The map grid coordinates are given in. */
  grid: "mga2020";
  /** Where the canyon-list import reads from, or null where there is none. */
  canyons: {
    kind: "ropewiki";
    /** RopeWiki's own name for the region, as its `Located in regions` holds it. */
    ropewikiRegion: string;
    /** The hand-exported snapshot in the media bucket (api `ropeWikiCache.ts`). */
    snapshotKey: string;
    /** Links added beside RopeWiki's own, matched by name. */
    extraLinks?: {
      label: string;
      match: (name: string, altNames: string[]) => string | null;
    };
  } | null;
};

/**
 * NSW Spatial Services' 5 m DEM: bare earth, from LiDAR in the east and
 * photogrammetry in the west, built by `topo/build_nsw_dem.py`. A z15 pixel is
 * ~4 m at this latitude, the first zoom finer than the data.
 */
const NSW_HEIGHTS = {
  id: "nsw-5m",
  sampleZoom: 15,
  // NSW and the ACT. Inside it a tile the build did not produce is simply
  // absent, and the position falls through.
  coverage: [140.9, -37.6, 153.7, -28.0],
  urlTemplate: null,
  archivePath: "master/dem/nsw-5m.pmtiles",
  // z15: full tiles of six whole sheets built by `topo/build_nsw_dem.py`, from
  // 4.7 KB on the Hay plain to 36 KB in the ranges. People save rugged ground,
  // so the p90 is the rugged figure, not a statistical one. z8–z14: one figure
  // for all seven, from clips of the Katoomba sheet (single zooms, tiles of
  // 43–56 KB) and of the Katoomba Falls box (the 15 tiles under z15 averaged
  // 59 KB), a rugged place, so it is the p90; the mean is the same 0.72 of it
  // that z15's is. Low zooms have too few whole tiles on the sheet to say more.
  // A save clips z8 to z15, the hillshade's zooms (`demClipMinZoom`).
  tileBytes: {
    8: { meanBytes: 42_000, p90Bytes: 60_000 },
    9: { meanBytes: 42_000, p90Bytes: 60_000 },
    10: { meanBytes: 42_000, p90Bytes: 60_000 },
    11: { meanBytes: 42_000, p90Bytes: 60_000 },
    12: { meanBytes: 42_000, p90Bytes: 60_000 },
    13: { meanBytes: 42_000, p90Bytes: 60_000 },
    14: { meanBytes: 42_000, p90Bytes: 60_000 },
    15: { meanBytes: 24_000, p90Bytes: 36_000 },
  },
  // The licence asks for the credit, the licence's name, a note that this is
  // derived, and the date it was extracted from Spatial Services.
  credit:
    "Elevation: derived from the NSW 5 m Digital Elevation Model, © State of New South Wales (Spatial Services), extracted October 2026. CC BY 3.0 AU.",
  creditHtml:
    'Elevation: derived from the NSW 5 m Digital Elevation Model, © State of New South Wales (<a href="https://www.spatial.nsw.gov.au">Spatial Services</a>), extracted October 2026. <a href="https://creativecommons.org/licenses/by/3.0/au/">CC BY 3.0 AU</a>.',
} as const satisfies DemSource & { tileBytes: TileBytes };

/** A layer cut from the heights carries their credit, under its own name. */
const derived = (layer: string) => ({
  coverage: NSW_HEIGHTS.coverage,
  credit: NSW_HEIGHTS.credit.replace(/^Elevation/, layer),
  creditHtml: NSW_HEIGHTS.creditHtml.replace(/^Elevation/, layer),
});

export const NSW_REGION = {
  id: "nsw",
  name: "NSW",
  // The Blue Mountains.
  view: { center: [150.31, -33.7], zoom: 9 },
  timeZone: SYDNEY_TZ,
  // Geofabrik's outline of its New South Wales extract, which takes in the
  // ACT (© OpenStreetMap contributors, ODbL), cut at 154.2° E to leave out
  // Lord Howe Island and the sea out to it, then buffered and simplified to
  // 0.1°, so it holds the whole of what is left.
  borders: [
    [
      [141.49, -34.32],
      [140.9, -34.04],
      [140.96, -28.91],
      [148.91, -28.9],
      [149.47, -28.48],
      [150.29, -28.44],
      [151.06, -28.65],
      [151.39, -29.02],
      [151.66, -28.78],
      [151.92, -28.82],
      [151.87, -28.45],
      [152.49, -28.15],
      [153.06, -28.24],
      [153.63, -28.04],
      [154.29, -28.41],
      [154.24, -37.73],
      [150.01, -37.63],
      [148.05, -36.89],
      [147.92, -36.2],
      [147.69, -36.05],
      [146.94, -36.22],
      [145.11, -35.94],
      [145.04, -36.16],
      [144.7, -36.22],
      [143.32, -35.27],
      [143.14, -34.82],
      [142.53, -34.88],
      [142.13, -34.28],
    ],
  ],
  // The vector basemap is the region's own extract of OpenStreetMap.
  basemaps: ["protomaps", "six-topo", "six-base", "six-imagery"],
  defaultBasemap: "six-topo",
  // The catalogue entry "protomaps" (geoPdfBaseLayers.ts) reads this path and
  // zoom from here.
  vector: { archivePath: "master/basemap/protomaps-nsw.pmtiles", maxzoom: 15 },
  dem: [NSW_HEIGHTS],
  terrain: {
    heights: NSW_HEIGHTS,
    // Baked once as a fake DEM: a terrarium archive whose "height" is the
    // slope in degrees (ADR 0030 encoding), built by `topo/build_nsw_dem.py
    // slope`, beside the heights. z15 is Horn over the z15 height tiles
    // (equal to `demSlopeAt`); each coarser zoom is the max of the one below,
    // so a cliff never fades out of its band as the map zooms out.
    slope: {
      id: "nsw-5m-slope",
      archivePath: "master/dem/nsw-5m-slope.pmtiles",
      minzoom: 8,
      maxzoom: 15,
      // Measured from every whole tile of the Katoomba sheet, one of the most
      // rugged, so the mean is already a mountain figure: 1° steps, PNG level
      // 6. Zooms under 11 take z11's, as the sheet holds no whole tile there.
      tileBytes: {
        8: { meanBytes: 39_000, p90Bytes: 64_000 },
        9: { meanBytes: 39_000, p90Bytes: 64_000 },
        10: { meanBytes: 39_000, p90Bytes: 64_000 },
        11: { meanBytes: 39_000, p90Bytes: 64_000 },
        12: { meanBytes: 40_000, p90Bytes: 58_000 },
        13: { meanBytes: 42_000, p90Bytes: 53_000 },
        14: { meanBytes: 36_000, p90Bytes: 45_000 },
        15: { meanBytes: 28_000, p90Bytes: 33_000 },
      },
      ...derived("Slope"),
    },
    // MapLibre's own `hillshade` layer on the height archive itself, at the
    // zooms it was built at, so it needs no pipeline at all.
    hillshade: {
      id: "nsw-5m-hillshade",
      archivePath: NSW_HEIGHTS.archivePath,
      minzoom: 8,
      maxzoom: NSW_HEIGHTS.sampleZoom,
      // Shaded from the height archive itself, so a save clips it once, as the
      // heights.
      tileBytes: NSW_HEIGHTS.tileBytes,
      ...derived("Hillshade"),
    },
    // 10 m contours cut from the heights by `topo/build_nsw_dem.py contours`,
    // in the schema a topo area's own contour layer has, so both clients
    // style it with the code they already have. Deeper zooms overzoom the
    // last (`CONTOUR_ZOOMS` in the build script).
    contours: {
      id: "nsw-contours",
      archivePath: "master/contours/nsw-10m.pmtiles",
      minzoom: 11,
      maxzoom: 14,
      // Measured from single-zoom clips of the Katoomba and Port Hacking
      // sheets. A clip is whole tiles, so a small area costs far more per
      // square kilometre than a large one, and only a tile count says so.
      // People save rugged ground: the p90 is the Grose gorge, the mean leans
      // toward the mountains and away from the coastal plain, which is a third
      // to a quarter of it.
      tileBytes: {
        11: { meanBytes: 110_000, p90Bytes: 147_000 },
        12: { meanBytes: 40_000, p90Bytes: 47_000 },
        13: { meanBytes: 15_000, p90Bytes: 18_000 },
        14: { meanBytes: 24_000, p90Bytes: 28_000 },
      },
      ...derived("Contours"),
    },
    // Who holds the land, from the NSW Land Tenure layer, built by
    // `topo/build_land_tenure.py` (land.ts draws it).
    land: {
      id: "nsw-land",
      archivePath: "master/land/nsw-tenure.pmtiles",
      /** The build script's `SOURCE_LAYER` (test_land_tenure.py). */
      sourceLayer: "land",
      /** The source's attribute, kept as it is (test_land_tenure.py). */
      classProperty: "TenureClass",
      /** The build script's zooms (test_land_tenure.py): z13 is about a metre, and deeper ones overzoom. */
      minzoom: 8,
      maxzoom: 13,
      // Measured as stored (gzip), from every tile of a 40 km Blue Mountains
      // box. A save keeps z12 and z13 (`landClip`).
      tileBytes: {
        12: { meanBytes: 7_000, p90Bytes: 15_000 },
        13: { meanBytes: 3_600, p90Bytes: 8_500 },
      },
      /**
       * `TENURE_CLASSES` in the build script lists the same `source` values,
       * and the build stops on any other, because `landColor` leaves a class
       * it doesn't know undrawn (test_land_tenure.py).
       *
       * The source calls "Aboriginal Area" "Indigenous Owned", but all it
       * holds there are NPWS reserves of that type; Land Council freehold can
       * be under Private.
       */
      classes: [
        { source: "Private", name: "Private land", colour: "#8e6bbf" },
        { source: "National Park", name: "National park", colour: "#2f9c95" },
        { source: "State Forest", name: "State forest", colour: "#7f8f3a" },
        {
          source: "Crownland-Leasehold",
          name: "Crown leasehold",
          colour: "#d9a441",
        },
        { source: "Crownland-Other", name: "Crown land", colour: "#e6d34f" },
        {
          source: "Indigenous Owned",
          name: "Aboriginal Area",
          colour: "#3b78c4",
        },
        {
          source: "Unresolved Tenure",
          name: "Tenure unresolved",
          colour: "#8a8a8a",
        },
      ],
      // The source's two known gaps.
      caveat:
        "Land Council freehold can show as private land. Roads, waterways and public areas aren't properly mapped around Sydney and Wollongong.",
      coverage: NSW_HEIGHTS.coverage,
      credit:
        "Land: NSW Land Tenure, December 2024 v2 © State of New South Wales (Department of Primary Industries and Regional Development), CC BY 4.0",
      creditHtml:
        'Land: <a href="https://data.nsw.gov.au/data/dataset/nsw-land-tenure">NSW Land Tenure</a>, December 2024 v2 &copy; State of New South Wales (Department of Primary Industries and Regional Development), <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>',
    },
    // How long since the ground last burnt, from NPWS Fire History, built by
    // `topo/build_fire_history.py` (fireHistory.ts draws it). The archive holds
    // the fire's year and month, never how long ago that was: each client
    // works that out from today, so the map doesn't age between builds.
    fire: {
      /** A saved clip is filed under this, beside the area it was saved with. */
      id: "nsw-fire",
      archivePath: "master/fire/nsw-fire-history.pmtiles",
      /** The build script's `OVERLAY_LAYER` (test_fire_overlay.py). */
      sourceLayer: "fire",
      /** The fire's year and month (1 to 12), from its end date, or its start
       *  date while it has none: the vegetation layer's rule. */
      yearProperty: "year",
      monthProperty: "month",
      /** The source's `FireType` code, absent where it had none: `types`. */
      typeProperty: "type",
      /** The build script's zooms: fires are mapped to tens of metres, and z12 is
       *  finer than that. Deeper zooms overzoom. */
      minzoom: 8,
      maxzoom: 12,
      // Measured as stored (gzip), from every tile of a 40 km Blue Mountains
      // box, in the November 2026 build. A coarse tile holds every fire under
      // it, so it weighs most.
      tileBytes: {
        8: { meanBytes: 89_000, p90Bytes: 136_000 },
        9: { meanBytes: 49_000, p90Bytes: 83_000 },
        10: { meanBytes: 23_000, p90Bytes: 64_000 },
        11: { meanBytes: 9_700, p90Bytes: 33_000 },
        12: { meanBytes: 3_100, p90Bytes: 9_000 },
      },
      // A code not listed reads as a plain "Fire" (fireHistory.ts).
      types: { 1: "Wildfire", 2: "Prescribed burn" },
      // The source's gap.
      caveat:
        "Mapped by NSW National Parks and Wildlife Service: a fire it didn't map, often on private land, has no colour.",
      coverage: NSW_HEIGHTS.coverage,
      credit:
        "Fire history © State Government of NSW and NSW Department of Climate Change, Energy, the Environment and Water 2010 — NPWS Fire History - Wildfires and Prescribed Burns (CC BY 4.0)",
      creditHtml:
        'Fire history &copy; State Government of NSW and NSW Department of Climate Change, Energy, the Environment and Water 2010 — <a href="https://datasets.seed.nsw.gov.au/dataset/fire-history-wildfires-and-prescribed-burns-1e8b6">NPWS Fire History - Wildfires and Prescribed Burns</a> (<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>)',
    },
    // Where the user's carrier predicts a phone won't work, from the ACCC
    // Mobile Infrastructure Report data, built by `topo/build_coverage.py`
    // (coverage.ts draws it). One archive holds every carrier.
    coverage: {
      id: "nsw-coverage",
      archivePath: "master/coverage/nsw-coverage.pmtiles",
      /** The build script's `SOURCE_LAYER` (test_coverage.py). */
      sourceLayer: "coverage",
      /** A `carriers` id. */
      carrierProperty: "carrier",
      /** A `COVERAGE_LEVELS` level. */
      levelProperty: "level",
      /** The build script's zooms: z12 alone, where the overlay is drawn from
       *  (`COVERAGE_MIN_ZOOM`); its grid is about 50 m, finer than the hatch's
       *  spacing (about 190 m at z12). Deeper zooms overzoom. */
      minzoom: 12,
      maxzoom: 12,
      // Measured as stored (gzip), every carrier's together, from every tile
      // of a 40 km Blue Mountains box, in the 2026 release's build.
      tileBytes: { 12: { meanBytes: 8_300, p90Bytes: 13_900 } },
      /**
       * The three networks that own one. `NETWORKS` in the build script has the
       * same ids (test_coverage.py). A reseller uses one of these; Telstra's
       * resellers get less than Telstra's own map, which the caveat says.
       */
      carriers: [
        { id: "telstra", name: "Telstra" },
        { id: "optus", name: "Optus" },
        { id: "tpg", name: "TPG" },
      ],
      // The source's limits.
      caveat:
        "It's a prediction, and valley and canyon floors are where it's most often wrong. A reseller on Telstra's network may get less than Telstra's own.",
      coverage: NSW_HEIGHTS.coverage,
      credit:
        "Mobile coverage: ACCC Mobile Infrastructure Report data release © Commonwealth of Australia (ACCC), CC BY 2.5 AU; coastline © ABS, CC BY 4.0",
      creditHtml:
        'Mobile coverage: <a href="https://data.gov.au/data/dataset/accc-mobile-infrastructure-report-data-release">ACCC Mobile Infrastructure Report data release</a> &copy; Commonwealth of Australia (ACCC), <a href="https://creativecommons.org/licenses/by/2.5/au/">CC BY 2.5 AU</a>; coastline &copy; <a href="https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs-edition-3">ABS</a>, <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>',
    },
  },
  placeSearch: PLACE_REGISTRY_PREFIX,
  gauges: GAUGE_PREFIX,
  grid: "mga2020",
  canyons: {
    kind: "ropewiki",
    ropewikiRegion: "New South Wales",
    snapshotKey: "reference/ropewiki-nsw.csv",
    extraLinks: { label: "OzUltimate", match: matchOzUltimateUrl },
  },
} as const satisfies Region;

/**
 * Whether the simulated regions (simRegions.ts) are declared. A module-load
 * read: `DEM_SOURCES` and the clients' entry tables are computed at load, so a
 * runtime that wants them sets the flag before shared loads (Logjam Web in
 * `frontend/src/simRegions.ts`, Logjam GPS in `mobile/src/simRegions.ts`, the
 * API in `api/src/loadEnv.ts`, each refusing it outside a dev stack). Guard:
 * `regions.test.ts` ("puts the simulated regions and their world in the
 * declaration at load").
 */
export function simRegionsOn(): boolean {
  return (
    (globalThis as { LOGJAM_SIM_REGIONS?: unknown }).LOGJAM_SIM_REGIONS === true
  );
}

/** Every region, in the order a picker lists them. */
export const REGIONS: readonly Region[] = simRegionsOn()
  ? [NSW_REGION, ...SIM_REGIONS]
  : [NSW_REGION];

/**
 * What answers outside every region: no border, so never in `REGIONS` and
 * never returned by `regionAt`. It declares nothing in prod. Guards:
 * `regions.test.ts` ("declares only NSW unless the simulated-regions flag is
 * set", "never returns the world"). Nothing reads it yet. `DEM_SOURCES` is
 * built from `REGIONS` alone, so switching the worldwide tier on means setting
 * `vector` and `terrain` here and also adding its heights to `DEM_SOURCES`.
 */
const EMPTY_WORLD: Region = {
  id: "world",
  name: "The world",
  view: { center: [0, 0], zoom: 2 },
  timeZone: "UTC",
  borders: [],
  basemaps: [],
  // Worldwide entries belong to no region's list (regions.test.ts, "opens each
  // region on one of its own basemaps").
  defaultBasemap: "osm-topo",
  vector: null,
  dem: [],
  terrain: {},
  placeSearch: null,
  gauges: null,
  grid: "mga2020",
  canyons: null,
};
export const WORLD: Region = simRegionsOn() ? SIM_WORLD : EMPTY_WORLD;

/** What an account that never chose has: everyone who signed up before a second region. */
export const DEFAULT_REGION_IDS: readonly string[] = [NSW_REGION.id];

/**
 * A stored or sent choice as the ids of known regions, in `REGIONS` order:
 * unknown ids dropped, and anything that leaves none (absent, damaged, every
 * id retired) read as the default.
 */
export function normalizeRegionIds(
  value: unknown,
  regions: readonly Region[] = REGIONS,
): string[] {
  const ids = Array.isArray(value) ? value : [];
  const known = regions.filter((r) => ids.includes(r.id)).map((r) => r.id);
  return known.length > 0 ? known : [...DEFAULT_REGION_IDS];
}

/**
 * The account's home: the first of its chosen regions in `REGIONS` order, or
 * the default region for an account that never chose. What a user's season,
 * plan day and first-run map view follow; never what a map offers at a place.
 * Guard: `regions.test.ts` ("accountRegion").
 */
export function accountRegion(
  uiPreferences: unknown,
  regions: readonly Region[] = REGIONS,
): Region {
  const chosen =
    typeof uiPreferences === "object" && uiPreferences !== null
      ? (uiPreferences as { regions?: unknown }).regions
      : undefined;
  return (
    regionsOf(normalizeRegionIds(chosen, regions), regions)[0] ?? regions[0]!
  );
}

/** The regions behind a choice, in `REGIONS` order. */
export function regionsOf(
  ids: readonly string[],
  regions: readonly Region[] = REGIONS,
): Region[] {
  return regions.filter((r) => ids.includes(r.id));
}

/**
 * The chosen regions Logjam offers a canyon-list import for: one offer each.
 * Guard: `regions.test.ts`.
 */
export function canyonRegionsOf(
  ids: readonly string[],
  regions: readonly Region[] = REGIONS,
): Region[] {
  return regionsOf(ids, regions).filter((region) => region.canyons !== null);
}

/**
 * Whether a user is asked where they canyon: only once there is a choice to
 * make. Guard: each client's region step and settings section tests.
 */
export function offersRegionChoice(
  regions: readonly Region[] = REGIONS,
): boolean {
  return regions.length > 1;
}

export type LonLatBox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/** The box of one point: the view of a map that has not yet said what it shows. */
export function pointBox(lon: number, lat: number): LonLatBox {
  return { west: lon, south: lat, east: lon, north: lat };
}

/**
 * The same box moved by whole turns until its centre is in [-180, 180): a map
 * panned round the world reports longitudes past ±180, while a region's
 * borders and a hemisphere are read in that range. Guard: `regions.test.ts`
 * ("moves a box by whole turns until its centre is in [-180, 180)").
 */
export function wrapView(view: LonLatBox): LonLatBox {
  const turn = 360 * Math.floor(((view.west + view.east) / 2 + 180) / 360);
  return turn === 0
    ? view
    : { ...view, west: view.west - turn, east: view.east - turn };
}

/**
 * The box around a region's borders. Throws for a region with none (`WORLD`),
 * which has no box. Guard: `regions.test.ts` ("bounds the border, and refuses a
 * region with none").
 */
export function regionBounds(region: Region): LonLatBox {
  const points = region.borders.flat();
  if (points.length === 0)
    throw new Error(`Region ${region.id} has no border to bound`);
  const lons = points.map(([lon]) => lon);
  const lats = points.map(([, lat]) => lat);
  return {
    west: Math.min(...lons),
    south: Math.min(...lats),
    east: Math.max(...lons),
    north: Math.max(...lats),
  };
}

function inRing(ring: Ring, lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}

/** Whether segment p1–p2 crosses segment p3–p4. */
function crosses(
  [x1, y1]: readonly [number, number],
  [x2, y2]: readonly [number, number],
  [x3, y3]: readonly [number, number],
  [x4, y4]: readonly [number, number],
): boolean {
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (d === 0) return false;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function ringTouchesBox(ring: Ring, box: LonLatBox): boolean {
  const corners = [
    [box.west, box.south],
    [box.east, box.south],
    [box.east, box.north],
    [box.west, box.north],
  ] as const;
  if (corners.some(([lon, lat]) => inRing(ring, lon, lat))) return true;
  if (
    ring.some(
      ([lon, lat]) =>
        lon >= box.west &&
        lon <= box.east &&
        lat >= box.south &&
        lat <= box.north,
    )
  )
    return true;
  return ring.some((a, i) => {
    const b = ring[(i + 1) % ring.length]!;
    return corners.some((c, k) => crosses(a, b, c, corners[(k + 1) % 4]!));
  });
}

/**
 * Whether a box and any of a region's borders share ground: a corner of one
 * inside the other, or an edge of each crossing.
 */
export function regionTouchesBox(region: Region, box: LonLatBox): boolean {
  return region.borders.some((ring) => ringTouchesBox(ring, box));
}

/**
 * The areas of `areas` whose survey box shares ground with `region`'s border:
 * the ones a map or a save of that region draws from, the same test the
 * area-export check applies (`areaInTerrainRegion`). A box centred just
 * outside the border still counts. Guard: `regions.test.ts` ("areasInRegion").
 */
export function areasInRegion<
  A extends { coverage: readonly [number, number, number, number] },
>(region: Region | null, areas: readonly A[]): A[] {
  if (!region) return [];
  return areas.filter(({ coverage: [west, south, east, north] }) =>
    regionTouchesBox(region, { west, south, east, north }),
  );
}

/**
 * The region whose border holds a point, in `REGIONS` order, or null. Never
 * `WORLD`, which has no border. Guard: `regions.test.ts` ("never returns the
 * world").
 */
export function regionAt(
  lon: number,
  lat: number,
  regions: readonly Region[] = REGIONS,
): Region | null {
  return (
    regions.find((region) =>
      region.borders.some((ring) => inRing(ring, lon, lat)),
    ) ?? null
  );
}

/**
 * Every region whose border shares ground with a box, in `REGIONS` order: what
 * covers a box that is saved, printed or exported.
 */
export function regionsTouching(
  box: LonLatBox,
  regions: readonly Region[] = REGIONS,
): Region[] {
  return regions.filter((region) => regionTouchesBox(region, box));
}

/** Whether a region declares a vector basemap or any Terrain archive. */
function declaresAnything(region: Region): boolean {
  return (
    region.vector !== null ||
    Object.values(region.terrain).some((archive) => archive !== undefined)
  );
}

/**
 * The one region a map draws from: the one holding the view's centre, else the
 * first touching the view, else `world` when it declares anything, else null.
 * // ponytail: a map that draws from this answer draws one region's Terrain
 * group and vector basemap at a time, so with two regions on screen the one
 * under the centre wins. Upgrade: a source per region per layer.
 */
export function regionInView(
  view: LonLatBox,
  regions: readonly Region[] = REGIONS,
  world: Region = WORLD,
): Region | null {
  return (
    regionAt(
      (view.west + view.east) / 2,
      (view.south + view.north) / 2,
      regions,
    ) ??
    regionsTouching(view, regions)[0] ??
    (declaresAnything(world) ? world : null)
  );
}

/**
 * `regionInView` for a view as a map reports it: its longitudes wrapped first
 * (`wrapView`), since a map panned round the world reports them past ±180 and
 * a region's borders are read in [-180, 180). What a map asks of the region it
 * shows. Guard: `regions.test.ts` ("reads a view panned past the antimeridian").
 */
export function regionInWrappedView(
  view: LonLatBox,
  regions: readonly Region[] = REGIONS,
  world: Region = WORLD,
): Region | null {
  return regionInView(wrapView(view), regions, world);
}

/** A region's archive for a Terrain layer, or null: the layer is not available here. */
export function layerIn<K extends keyof RegionTerrain>(
  region: Region | null,
  key: K,
): NonNullable<RegionTerrain[K]> | null {
  return (region?.terrain[key] ?? null) as NonNullable<RegionTerrain[K]> | null;
}
