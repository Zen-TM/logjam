// The map's layers: Logjam Web's `map/LayersPopover.tsx` and Logjam GPS's
// `map/MapLayersSheet.tsx`, the one surface that sits over the map (§1: the
// map is the main thing, so this is for choosing, not for reading).
//
// What each client lists INSIDE its overlays pane is not declared here: Logjam
// GPS draws every kind of line its phone holds (routes, imported ways, tracks)
// and GeoPDFs as rows of their own, Logjam Web draws one "Ways" row.
import { MAP_TERRAIN } from "./mapTerrain.js";
import { WAY_IMPORT } from "./ways.js";
import type { ScreenContract } from "./types.js";

export const MAP_LAYERS = {
  id: "map.layers",
  title: "Map layers",
  sections: [
    { key: "basemap" },
    { key: "terrain" },
    { key: "overlays" },
    // Its own tab, not a row of Overlays: the layer choice, the key and the
    // credit are the content, so the tab holds them inline.
    { key: "weather" },
    {
      key: "offline",
      on: "gps",
      reason:
        "Saved maps and 'use only saved maps' are phone features: Logjam Web is never used without a connection.",
    },
  ],
  copy: {
    tabBasemap: "Map",
    tabTerrain: MAP_TERRAIN.title,
    tabOverlays: "Overlays",
    tabWeather: MAP_TERRAIN.copy.weather,
    // The Weather tab's switch, the same words on both clients.
    showWeather: "Show weather",
    tabOffline: "Offline",
    places: "Places",
    ways: "Ways",
    // The overlays list ends with the way to add one, named the same on both
    // clients: GPX, KML and GeoJSON (`WAY_IMPORT`).
    importFile: WAY_IMPORT.file,
  },
} as const satisfies ScreenContract;
