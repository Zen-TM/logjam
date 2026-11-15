// The map's Overlays list: the rows of the layers sheet's (Logjam GPS) and
// popover's (Logjam Web) Overlays tab, in order. Logjam Web's rows are the
// list; Logjam GPS draws the same ones and may refine a row with sub-switches
// under it, declared below, each saying what it refines.
//
// A row's switch draws or hides that kind of thing on the map. Whose a thing is
// never splits a row: "mine" and "shared with me" are the same kind of thing
// drawn the same way, and the pin itself says whose it is.
import { GRID_NAMES, wrapLon, type GridId } from "../grids.js";
import { REGIONS, regionAt, type Region } from "../regions.js";
import { GAUGES } from "./gauges.js";
import { MAP_LAYERS } from "./mapLayers.js";
import { MAP_TERRAIN } from "./mapTerrain.js";
import type { ScreenContract } from "./types.js";

export const MAP_OVERLAYS = {
  id: "map.overlays",
  sections: [
    { key: "places" },
    { key: "ways" },
    {
      key: "geoPdfs",
      on: "gps",
      reason:
        "A GeoPDF is imported onto the phone and drawn by its own switch there; Logjam Web makes them but does not draw them.",
    },
    { key: "land" },
    { key: "fire" },
    { key: "coverage" },
    { key: "gauges" },
    { key: "mgaGrid" },
    { key: "importFile" },
  ],
  copy: {
    places: MAP_LAYERS.copy.places,
    ways: MAP_LAYERS.copy.ways,
    land: MAP_TERRAIN.copy.land,
    fire: MAP_TERRAIN.copy.fire,
    coverage: MAP_TERRAIN.copy.coverage,
    gauges: GAUGES.copy.overlay,
    geoPdfs: "GeoPDF maps",
    importFile: MAP_LAYERS.copy.importFile,
  },
} as const satisfies ScreenContract;

/**
 * The grid the overlay is named for at `at`, the view's centre (`gridZonesFor`
 * picks its grid the same way): the region's there. Where the centre is in no
 * region, one declared region still names its own grid (MGA2020 is the grid of
 * all Australia, so prod reads "MGA" wherever the map is) and two or more name
 * UTM, the grid drawn there. With no view yet it names the first region's grid.
 * Guard: `contracts.test.ts`, "the grid row's title".
 */
export function gridNamedAt(
  at: { lon: number; lat: number } | null,
  regions: readonly Region[] = REGIONS,
): GridId {
  const only = regions.length === 1 ? regions[0] : undefined;
  return at
    ? ((regionAt(wrapLon(at.lon), at.lat, regions) ?? only)?.grid ?? "utm")
    : (regions[0]?.grid ?? "utm");
}

/** The grid row's title: "MGA grid" in NSW. */
export function gridOverlayTitle(
  at: { lon: number; lat: number } | null,
  regions: readonly Region[] = REGIONS,
): string {
  return `${GRID_NAMES[gridNamedAt(at, regions)]} grid`;
}

/**
 * What a fresh install draws, on both clients: the user's own pins, and
 * nothing that fetches a public file (river gauges) or draws across every map
 * (the map grid) until it is asked for. Ways are left out: Logjam GPS splits
 * them into the sub-switches below. Guards: `contracts.test.ts`, and each
 * client's test that a fresh install reads these.
 */
export const MAP_OVERLAY_DEFAULTS: Readonly<
  Record<"places" | "gauges" | "mgaGrid", boolean>
> = {
  places: true,
  gauges: false,
  mgaGrid: false,
};

/**
 * Sub-switches Logjam GPS draws under a row, one level deep. Logjam Web has
 * none: it has the room to say "Every line you have" and the map's own legend.
 * On a phone in a canyon, "stop drawing campsites" and "hide my tracks" are
 * the two things worth a switch each.
 */
export const MAP_OVERLAY_REFINEMENTS = {
  places: {
    // One per place type, from the user's own vocabulary, then the one axis
    // that crosses every type.
    sharedWithMe: "Shared with me",
  },
  ways: {
    routes: "My routes",
    placeRoutes: "Place routes",
    importedWays: "Imported ways",
    tracks: "Tracks",
  },
} as const;
