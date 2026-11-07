// The regions Logjam has maps, terrain and a canyon list for, and the one
// declaration each client, the API and topo/ read them from. NSW is the first.
//
// Choosing regions controls what Logjam offers (the basemaps a gallery lists,
// the canyon-list import, the layer switches), never what answers for a
// location: heights, terrain tiles, gauges and the area-export check follow
// coverage, whatever a user chose (ADR 0028 for heights). Worldwide sources
// (TERRARIUM, the OSM rasters, Open-Meteo) belong to no region.
//
// Stored ids and paths keep their values: `nsw-5m`, `six-*`,
// `master/dem/nsw-5m.pmtiles`, `master/places/v1/` and `master/gauges/v1/` are
// on phones, in tracks' climb labels and in installed builds. A new region's
// archives go under `master/<kind>/<region>-…`, as NSW's terrain already does.
import type { DemSource } from "./demSources.js";
import { GAUGE_PREFIX } from "./gauges.js";
import { matchOzUltimateUrl } from "./ozUltimate.js";
import { PLACE_REGISTRY_PREFIX } from "./placeRegistry.js";

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
};

export type Region = {
  /** Stored in `uiPreferences.regions`: never change one. */
  id: string;
  /** What user copy calls it: "That area is outside NSW". */
  name: string;
  /** Where a map opens before the user has moved it. */
  view: { center: readonly [lon: number, lat: number]; zoom: number };
  /** IANA. Gauge days and trip-plan dates still read `SYDNEY_TZ` until a second region. */
  timeZone: string;
  /**
   * The border, simplified, as one ring of [lon, lat], drawn a little outside
   * the real one so it never cuts off ground the region's data covers. A box
   * would not do: neighbouring countries' boxes overlap.
   */
  border: readonly (readonly [number, number])[];
  /** Ids in `BASEMAP_CATALOG`, each in one region at most (regions.test.ts). */
  basemaps: readonly string[];
  /** The one a map opens on before the user picks; one of `basemaps`. */
  defaultBasemap: string;
  /** Height sources, finest first. `DEM_SOURCES` is every region's, then the worldwide one. */
  dem: readonly DemSource[];
  /** The Terrain group's archives, or null where the region has none. */
  terrain: {
    /** The height source the archives below are cut from; one of `dem`. */
    heights: DemSource & {
      archivePath: string;
      coverage: TerrainArchive["coverage"];
    };
    slope: TerrainArchive;
    hillshade: TerrainArchive;
    contours: TerrainArchive;
    land: TerrainArchive & { sourceLayer: string; classProperty: string };
  } | null;
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
  // The licence asks for the credit, the licence's name, a note that this is
  // derived, and the date it was extracted from Spatial Services.
  credit:
    "Elevation: derived from the NSW 5 m Digital Elevation Model, © State of New South Wales (Spatial Services), extracted October 2026. CC BY 3.0 AU.",
  creditHtml:
    'Elevation: derived from the NSW 5 m Digital Elevation Model, © State of New South Wales (<a href="https://www.spatial.nsw.gov.au">Spatial Services</a>), extracted October 2026. <a href="https://creativecommons.org/licenses/by/3.0/au/">CC BY 3.0 AU</a>.',
} as const satisfies DemSource;

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
  timeZone: "Australia/Sydney",
  // Geofabrik's outline of its New South Wales extract, which takes in the
  // ACT (© OpenStreetMap contributors, ODbL), cut at 154.2° E to leave out
  // Lord Howe Island and the sea out to it, then buffered and simplified to
  // 0.1°, so it holds the whole of what is left.
  border: [
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
  // The vector basemap is the region's own extract of OpenStreetMap.
  basemaps: ["protomaps", "six-topo", "six-base", "six-imagery"],
  defaultBasemap: "six-topo",
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
      ...derived("Slope"),
    },
    // MapLibre's own `hillshade` layer on the height archive itself, at the
    // zooms it was built at, so it needs no pipeline at all.
    hillshade: {
      id: "nsw-5m-hillshade",
      archivePath: NSW_HEIGHTS.archivePath,
      minzoom: 8,
      maxzoom: NSW_HEIGHTS.sampleZoom,
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
      ...derived("Contours"),
    },
    // Who holds the land, from the NSW Land Tenure layer, built by
    // `topo/build_land_tenure.py` (nswLand.ts draws it).
    land: {
      id: "nsw-land",
      archivePath: "master/land/nsw-tenure.pmtiles",
      /** The build script's `SOURCE_LAYER` (test_land_tenure.py). */
      sourceLayer: "land",
      /** The source's attribute, kept as it is (test_land_tenure.py). */
      classProperty: "TenureClass",
      /** The build script's zooms: z13 is about a metre, and deeper ones overzoom. */
      minzoom: 8,
      maxzoom: 13,
      coverage: NSW_HEIGHTS.coverage,
      credit:
        "Land: NSW Land Tenure, December 2024 v2 © State of New South Wales (Department of Primary Industries and Regional Development), CC BY 4.0",
      creditHtml:
        'Land: <a href="https://data.nsw.gov.au/data/dataset/nsw-land-tenure">NSW Land Tenure</a>, December 2024 v2 &copy; State of New South Wales (Department of Primary Industries and Regional Development), <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>',
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

/** Every region, in the order a picker lists them. */
export const REGIONS: readonly Region[] = [NSW_REGION];

/** What an account that never chose has: everyone who signed up before a second region. */
export const DEFAULT_REGION_IDS: readonly string[] = [NSW_REGION.id];

/**
 * A stored or sent choice as the ids of known regions, in `REGIONS` order:
 * unknown ids dropped, and anything that leaves none (absent, damaged, every
 * id retired) read as the default.
 */
export function normalizeRegionIds(value: unknown): string[] {
  const ids = Array.isArray(value) ? value : [];
  const known = REGIONS.filter((r) => ids.includes(r.id)).map((r) => r.id);
  return known.length > 0 ? known : [...DEFAULT_REGION_IDS];
}

/** The regions behind a choice, in `REGIONS` order. */
export function regionsOf(
  ids: readonly string[],
  regions: readonly Region[] = REGIONS,
): Region[] {
  return regions.filter((r) => ids.includes(r.id));
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

/** The box around a region's border. */
export function regionBounds(region: Region): LonLatBox {
  const lons = region.border.map(([lon]) => lon);
  const lats = region.border.map(([, lat]) => lat);
  return {
    west: Math.min(...lons),
    south: Math.min(...lats),
    east: Math.max(...lons),
    north: Math.max(...lats),
  };
}

function inRing(
  ring: readonly (readonly [number, number])[],
  lon: number,
  lat: number,
): boolean {
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

/**
 * Whether a box and a region's border share any ground: a corner of one
 * inside the other, or an edge of each crossing.
 */
export function regionTouchesBox(region: Region, box: LonLatBox): boolean {
  const corners = [
    [box.west, box.south],
    [box.east, box.south],
    [box.east, box.north],
    [box.west, box.north],
  ] as const;
  const ring = region.border;
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
