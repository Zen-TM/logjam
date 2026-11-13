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
import type { Region, RegionTerrain, Ring } from "./regions.js";

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
    ...credit("Elevation"),
  } as const satisfies DemSource;
  return {
    heights,
    slope: {
      id: `${id}-slope`,
      archivePath: `master/dem/${id}-slope.pmtiles`,
      minzoom: 8,
      maxzoom: 15,
      ...credit("Slope"),
    },
    hillshade: {
      id: `${id}-hillshade`,
      archivePath: heights.archivePath,
      minzoom: 8,
      maxzoom: heights.sampleZoom,
      ...credit("Hillshade"),
    },
    contours: {
      id: `${id}-contours`,
      archivePath: `master/contours/${id}-10m.pmtiles`,
      minzoom: 11,
      maxzoom: 14,
      ...credit("Contours"),
    },
  };
}

// Placeholder: two islands, one ring each. Heights cover the box round both,
// as NSW's do round its outline; a tile the build did not make is absent.
const NZ_SOUTH_BOX: Box = [169.0, -44.7, 169.2, -44.55]; // near Wanaka
const NZ_NORTH_BOX: Box = [175.5, -37.1, 175.7, -36.95]; // the Coromandel
const NZ_TERRAIN = simTerrain("simnz", "New Zealand", [
  NZ_SOUTH_BOX[0],
  NZ_SOUTH_BOX[1],
  NZ_NORTH_BOX[2],
  NZ_NORTH_BOX[3],
]);

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
  grid: "mga2020",
  canyons: null,
};

// Placeholder: one ring, in the western and northern hemispheres.
const UTAH_BOX: Box = [-110.9, 38.2, -110.7, 38.35];
const UTAH_TERRAIN = simTerrain("simutah", "Utah", UTAH_BOX);

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
  grid: "mga2020",
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
  grid: "mga2020",
  canyons: null,
};

export const SIM_REGIONS: readonly Region[] = [SIM_NZ, SIM_UTAH];
