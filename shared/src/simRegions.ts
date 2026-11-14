// Simulated regions: made-up declarations that stand in for a second and third
// region so every place-aware path can be run and tested without a real one.
// They hold published or invented values only, never a user's. `REGIONS`
// includes them only where `simRegionsOn()` (regions.ts) says so (guard:
// regions.test.ts, "declares only NSW unless the simulated-regions flag is
// set"); a unit test passes `SIM_REGIONS` as `regions` instead.
//
// Every box, id, path, zoom and credit here is a placeholder until the
// simulated-region archives are built, which sets the real values; the archive
// paths follow `master/<kind>/<id>-…`.
import type { DemSource } from "./demSources.js";
import { t } from "./i18n.js";
import type {
  CoverageArchive,
  Region,
  RegionTerrain,
  Ring,
  TileBytes,
} from "./regions.js";

type Box = readonly [number, number, number, number];

/** A ring round a data box `[west, south, east, north]`, a little outside it. */
function ringAround([west, south, east, north]: Box, margin = 0.02): Ring {
  return [
    [west - margin, south - margin],
    [east + margin, south - margin],
    [east + margin, north + margin],
    [west - margin, north + margin],
  ];
}

/**
 * Placeholder figures, not measurements: one size for every zoom of an archive,
 * until the simulated archives are built and their tiles measured.
 */
function placeholderTileBytes(minzoom: number, maxzoom: number): TileBytes {
  return Object.fromEntries(
    Array.from({ length: maxzoom - minzoom + 1 }, (_, i) => [
      minzoom + i,
      { meanBytes: 30_000, p90Bytes: 45_000 },
    ]),
  );
}

/** The heights, slope, hillshade and contours of a simulated region. */
function simTerrain(id: string, name: string, coverage: Box): RegionTerrain {
  const credit = (layer: string) => ({
    coverage,
    credit: `${layer}: simulated data for ${name}, not a real survey.`,
    creditHtml: `${layer}: simulated data for ${name}, not a real survey.`,
  });
  const heights = {
    id: `${id}-heights`,
    sampleZoom: 15,
    urlTemplate: null,
    archivePath: `master/dem/${id}-heights.pmtiles`,
    tileBytes: placeholderTileBytes(8, 15),
    ...credit("Elevation"),
  } as const satisfies DemSource & { tileBytes: TileBytes };
  return {
    heights,
    slope: {
      id: `${id}-slope`,
      archivePath: `master/dem/${id}-slope.pmtiles`,
      minzoom: 8,
      maxzoom: 15,
      tileBytes: placeholderTileBytes(8, 15),
      ...credit("Slope"),
    },
    hillshade: {
      id: `${id}-hillshade`,
      archivePath: heights.archivePath,
      minzoom: 8,
      maxzoom: heights.sampleZoom,
      tileBytes: heights.tileBytes,
      ...credit("Hillshade"),
    },
    contours: {
      id: `${id}-contours`,
      archivePath: `master/contours/${id}-10m.pmtiles`,
      minzoom: 11,
      maxzoom: 14,
      tileBytes: placeholderTileBytes(11, 14),
      ...credit("Contours"),
    },
  };
}

/**
 * The land, fire history and (when `carriers` is given) coverage archives of a
 * simulated region, with made-up vocabularies that differ from NSW's, so a
 * test can tell a region's own from NSW's. Nothing here is a real survey.
 */
function simOverlays(
  id: string,
  name: string,
  coverage: Box,
  carriers?: CoverageArchive["carriers"],
): Pick<RegionTerrain, "land" | "fire" | "coverage"> {
  const credit = (layer: string) => ({
    coverage,
    credit: `${layer}: simulated data for ${name}, not a real survey.`,
    creditHtml: `${layer}: simulated data for ${name}, not a real survey.`,
  });
  const caveat = t`Simulated data for ${name}: it describes no real ground.`;
  return {
    land: {
      id: `${id}-land`,
      archivePath: `master/land/${id}-tenure.pmtiles`,
      sourceLayer: "land",
      classProperty: "Holder",
      minzoom: 8,
      maxzoom: 13,
      tileBytes: placeholderTileBytes(8, 13),
      classes: [
        { source: "Public", name: t`Simulated public land`, colour: "#2a9d8f" },
        { source: "Leased", name: t`Simulated leased land`, colour: "#e9c46a" },
        { source: "Owned", name: t`Simulated owned land`, colour: "#9b5de5" },
      ],
      caveat,
      ...credit("Land"),
    },
    fire: {
      id: `${id}-fire`,
      archivePath: `master/fire/${id}-fire-history.pmtiles`,
      sourceLayer: "fire",
      yearProperty: "burntYear",
      monthProperty: "burntMonth",
      typeProperty: "burntType",
      minzoom: 8,
      maxzoom: 12,
      tileBytes: placeholderTileBytes(8, 12),
      types: { 1: t`Simulated wildfire`, 3: t`Simulated clearing burn` },
      caveat,
      ...credit("Fire history"),
    },
    ...(carriers && {
      coverage: {
        id: `${id}-coverage`,
        archivePath: `master/coverage/${id}-coverage.pmtiles`,
        sourceLayer: "coverage",
        carrierProperty: "network",
        levelProperty: "reception",
        minzoom: 12,
        maxzoom: 12,
        tileBytes: placeholderTileBytes(12, 12),
        carriers,
        caveat,
        ...credit("Mobile coverage"),
      },
    }),
  };
}

// Placeholder: two islands, one ring each. Heights cover the box round both,
// as NSW's do round its outline; a tile the build did not make is absent.
const NZ_SOUTH_BOX: Box = [169.0, -44.7, 169.2, -44.55]; // near Wanaka
const NZ_NORTH_BOX: Box = [175.5, -37.1, 175.7, -36.95]; // the Coromandel
const NZ_COVERAGE: Box = [
  NZ_SOUTH_BOX[0],
  NZ_SOUTH_BOX[1],
  NZ_NORTH_BOX[2],
  NZ_NORTH_BOX[3],
];
const NZ_TERRAIN: RegionTerrain = {
  ...simTerrain("simnz", "New Zealand", NZ_COVERAGE),
  ...simOverlays("simnz", "New Zealand", NZ_COVERAGE, [
    { id: "simone", name: t`Simulated One` },
    { id: "simtwo", name: t`Simulated Two` },
  ]),
};

export const SIM_NZ: Region = {
  id: "simnz",
  name: "Simulated New Zealand",
  view: { center: [169.1, -44.62], zoom: 11 },
  timeZone: "Pacific/Auckland",
  borders: [ringAround(NZ_SOUTH_BOX), ringAround(NZ_NORTH_BOX)],
  // The worldwide entries are the only basemaps a simulated region has.
  basemaps: [],
  defaultBasemap: "osm-topo",
  vector: {
    archivePath: "master/basemap/protomaps-simnz.pmtiles",
    maxzoom: 15,
  },
  dem: [NZ_TERRAIN.heights!],
  terrain: NZ_TERRAIN,
  placeSearch: null,
  gauges: null,
  grid: "nztm2000",
  canyons: null,
};

// Placeholder: one ring, in the western and northern hemispheres.
const UTAH_BOX: Box = [-110.9, 38.2, -110.7, 38.35];
// No coverage: a second simulated region that lacks a layer NZ has.
const UTAH_TERRAIN: RegionTerrain = {
  ...simTerrain("simutah", "Utah", UTAH_BOX),
  ...simOverlays("simutah", "Utah", UTAH_BOX),
};

export const SIM_UTAH: Region = {
  id: "simutah",
  name: "Simulated Utah",
  view: { center: [-110.8, 38.27], zoom: 11 },
  timeZone: "America/Denver",
  borders: [ringAround(UTAH_BOX)],
  basemaps: [],
  defaultBasemap: "osm-topo",
  vector: {
    archivePath: "master/basemap/protomaps-simutah.pmtiles",
    maxzoom: 15,
  },
  dem: [UTAH_TERRAIN.heights!],
  terrain: UTAH_TERRAIN,
  placeSearch: null,
  gauges: null,
  grid: "utm",
  canyons: null,
};

// Placeholder for the everywhere tier: whole-world coverage, where a tile the
// build did not make is absent.
const WORLD_TERRAIN = simTerrain(
  "simworld",
  "the world",
  [-180, -85.06, 180, 85.06],
);

export const SIM_WORLD: Region = {
  id: "world",
  name: "The world",
  view: { center: [0, 0], zoom: 2 },
  timeZone: "UTC",
  borders: [],
  basemaps: [],
  defaultBasemap: "osm-topo",
  vector: {
    archivePath: "master/basemap/protomaps-simworld.pmtiles",
    maxzoom: 15,
  },
  dem: [WORLD_TERRAIN.heights!],
  // The everywhere tier draws heights and hillshade only.
  terrain: {
    heights: WORLD_TERRAIN.heights,
    hillshade: WORLD_TERRAIN.hillshade,
  },
  placeSearch: null,
  gauges: null,
  grid: "utm",
  canyons: null,
};

export const SIM_REGIONS: readonly Region[] = [SIM_NZ, SIM_UTAH];
