// Simulated regions: made-up declarations that stand in for a second and third
// region so every place-aware path can be run and tested without a real one.
// They hold published or invented values only, never a user's. `REGIONS`
// includes them only where `simRegionsOn()` (regions.ts) says so (guard:
// regions.test.ts, "declares only NSW unless the simulated-regions flag is
// set"); a unit test passes `SIM_REGIONS` as `regions` instead.
//
// The boxes and the heights' top zoom are the ones scripts/sim-regions builds
// (guard: simRegionsBuild.test.ts); credits, tile sizes and the land, fire and
// coverage archives are placeholders, and the archive paths follow
// `master/<kind>/<id>-…`.
import type { DemSource } from "./demSources.js";
import { t } from "./i18n.js";
import type { LicenceId } from "./licences.js";
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

/**
 * The heights, slope, hillshade and contours of a simulated region, under
 * `licence`: the real publisher's, because the archives are cut from published
 * elevation models (`licences.test.ts`, "tags each simulated archive by where
 * its ground comes from"). The credit text is a placeholder until they are built.
 */
function simTerrain(
  id: string,
  name: string,
  coverage: Box,
  topZoom: number,
  licence: LicenceId,
): RegionTerrain {
  const credit = (layer: string) => ({
    coverage,
    licence,
    credit: t`${layer}: simulated data for ${name}, not a real survey.`,
    creditHtml: t`${layer}: simulated data for ${name}, not a real survey.`,
  });
  const heights = {
    id: `${id}-heights`,
    name: t`${name} (simulated)`,
    sampleZoom: topZoom,
    urlTemplate: null,
    archivePath: `master/dem/${id}-heights.pmtiles`,
    tileBytes: placeholderTileBytes(8, topZoom),
    ...credit(t`Elevation`),
  } as const satisfies DemSource & { name: string; tileBytes: TileBytes };
  return {
    heights,
    slope: {
      id: `${id}-slope`,
      archivePath: `master/dem/${id}-slope.pmtiles`,
      minzoom: 8,
      maxzoom: topZoom,
      tileBytes: placeholderTileBytes(8, topZoom),
      ...credit(t`Slope`),
    },
    hillshade: {
      id: `${id}-hillshade`,
      archivePath: heights.archivePath,
      minzoom: 8,
      maxzoom: heights.sampleZoom,
      tileBytes: heights.tileBytes,
      ...credit(t`Hillshade`),
    },
    contours: {
      id: `${id}-contours`,
      archivePath: `master/contours/${id}-10m.pmtiles`,
      minzoom: 11,
      maxzoom: 14,
      tileBytes: placeholderTileBytes(11, 14),
      ...credit(t`Contours`),
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
    licence: "cc0" as const,
    credit: t`${layer}: simulated data for ${name}, not a real survey.`,
    creditHtml: t`${layer}: simulated data for ${name}, not a real survey.`,
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
        {
          source: "Public",
          name: t`Simulated public land`,
          colour: "#2a9d8f",
        },
        {
          source: "Leased",
          name: t`Simulated leased land`,
          colour: "#e9c46a",
        },
        { source: "Owned", name: t`Simulated owned land`, colour: "#9b5de5" },
      ],
      caveat,
      ...credit(t`Land`),
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
      ...credit(t`Fire history`),
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
        ...credit(t`Mobile coverage`),
      },
    }),
  };
}

// Two islands, one ring each, round the boxes the build cuts. Heights cover the
// box round both, as NSW's do round its outline; a tile the build did not make
// is absent.
const NZ_SOUTH_BOX: Box = [169.2, -44.1, 169.3, -44.01]; // Makarora
const NZ_NORTH_BOX: Box = [175.58, -37.14, 175.68, -37.06]; // Kauaeranga
const NZ_COVERAGE: Box = [
  NZ_SOUTH_BOX[0],
  NZ_SOUTH_BOX[1],
  NZ_NORTH_BOX[2],
  NZ_NORTH_BOX[3],
];
const NZ_TERRAIN: RegionTerrain = {
  // LINZ's 1 m model (CC BY 4.0); outside its survey the heights are the
  // Copernicus model's, also open.
  ...simTerrain("simnz", t`New Zealand`, NZ_COVERAGE, 17, "cc-by-4"),
  ...simOverlays("simnz", t`New Zealand`, NZ_COVERAGE, [
    { id: "simone", name: t`Simulated One` },
    { id: "simtwo", name: t`Simulated Two` },
  ]),
};

export const SIM_NZ: Region = {
  id: "simnz",
  name: t`Simulated New Zealand`,
  fullName: t`Simulated New Zealand`,
  view: { center: [169.25, -44.055], zoom: 11 },
  timeZone: "Pacific/Auckland",
  borders: [ringAround(NZ_SOUTH_BOX), ringAround(NZ_NORTH_BOX)],
  // The worldwide entries are the only basemaps a simulated region has.
  basemaps: [],
  defaultBasemap: "osm-topo",
  // Each simulated vector archive is a cut of the OpenStreetMap-derived
  // vector basemap, so ODbL, as NSW's is.
  vector: {
    archivePath: "master/basemap/protomaps-simnz.pmtiles",
    maxzoom: 15,
    licence: "odbl",
  },
  dem: [NZ_TERRAIN.heights!],
  terrain: NZ_TERRAIN,
  placeSearch: null,
  placeSearchLicence: null,
  geocoderCountry: "nz",
  gauges: null,
  gaugesLicence: null,
  grid: "nztm2000",
  canyonGrades: "french",
  units: "metric",
  // Its heights go to z17, as fine as a survey would make them.
  sharpen: { mode: "off", reason: "already-fine" },
  canyons: null,
};

// One ring, in the western and northern hemispheres, round the box the build
// cuts (Zion).
const UTAH_BOX: Box = [-113.0, 37.24, -112.89, 37.33];
// No coverage: a second simulated region that lacks a layer NZ has.
const UTAH_TERRAIN: RegionTerrain = {
  // USGS's 3D Elevation Program.
  ...simTerrain("simutah", "Utah", UTAH_BOX, 15, "us-public-domain"),
  ...simOverlays("simutah", "Utah", UTAH_BOX),
};

export const SIM_UTAH: Region = {
  id: "simutah",
  name: t`Simulated Utah`,
  fullName: t`Simulated Utah`,
  view: { center: [-112.945, 37.285], zoom: 11 },
  timeZone: "America/Denver",
  borders: [ringAround(UTAH_BOX)],
  basemaps: [],
  defaultBasemap: "osm-topo",
  vector: {
    archivePath: "master/basemap/protomaps-simutah.pmtiles",
    maxzoom: 15,
    licence: "odbl",
  },
  dem: [UTAH_TERRAIN.heights!],
  terrain: UTAH_TERRAIN,
  placeSearch: null,
  placeSearchLicence: null,
  geocoderCountry: "us",
  gauges: null,
  languages: ["en-US"],
  gaugesLicence: null,
  grid: "utm",
  canyonGrades: "aca",
  units: "imperial",
  // Its heights stop at z15, and USGS publishes LiDAR of the box: the one
  // simulated region a survey can be sharpened in. No vegetation model.
  sharpen: {
    mode: "upload",
    portal: {
      name: "USGS",
      url: "https://apps.nationalmap.gov/lidar-explorer/",
      steps: "link",
    },
    credit:
      "Elevation: derived from a LiDAR survey, U.S. Geological Survey 3D Elevation Program{extracted}.",
    vegetation: false,
  },
  canyons: null,
};

// The everywhere tier: whole-world coverage, where a tile the build did not
// make is absent. Its heights stop at z13, as the planet file does.
const WORLD_TERRAIN = simTerrain(
  "simworld",
  t`the world`,
  [-180, -85.06, 180, 85.06],
  13,
  "copernicus-dem",
);

export const SIM_WORLD: Region = {
  id: "world",
  name: t`The world`,
  fullName: t`The world`,
  view: { center: [0, 0], zoom: 2 },
  timeZone: "UTC",
  borders: [],
  basemaps: [],
  defaultBasemap: "osm-topo",
  vector: {
    archivePath: "master/basemap/protomaps-simworld.pmtiles",
    maxzoom: 15,
    licence: "odbl",
  },
  dem: [WORLD_TERRAIN.heights!],
  // The everywhere tier draws heights and hillshade only.
  terrain: {
    heights: WORLD_TERRAIN.heights,
    hillshade: WORLD_TERRAIN.hillshade,
  },
  placeSearch: null,
  placeSearchLicence: null,
  gauges: null,
  gaugesLicence: null,
  grid: "utm",
  canyonGrades: "french",
  units: "metric",
  sharpen: { mode: "off", reason: "no-lidar" },
  canyons: null,
};

export const SIM_REGIONS: readonly Region[] = [SIM_NZ, SIM_UTAH];
