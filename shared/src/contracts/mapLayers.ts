// The map's layers: Logjam Web's `map/LayersPopover.tsx` and Logjam GPS's
// `map/MapLayersSheet.tsx`, the one surface that sits over the map (§1: the
// map is the main thing, so this is for choosing, not for reading).
//
// What each client lists INSIDE its overlays pane is not declared here: Logjam
// GPS draws every kind of line its phone holds (routes, imported ways, tracks)
// and GeoPDFs as rows of their own, Logjam Web draws one "Ways" row.
import { MAP_TERRAIN } from "./mapTerrain.js";
import type { ScreenContract } from "./types.js";

export const MAP_LAYERS = {
  id: "map.layers",
  title: "Map layers",
  sections: [
    {
      // The row above the tabs, so the sunlight scheme is one press, not three
      // levels down in Settings. Logjam Web is read at a desk.
      key: "brightLight",
      on: "gps",
      reason: "The sun is on a phone's screen; Logjam Web is read at a desk.",
    },
    { key: "basemap" },
    { key: "terrain" },
    { key: "overlays" },
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
    tabOffline: "Offline",
    brightLight: "Bright light",
    places: "Places",
    ways: "Ways",
    // The overlays list ends with the way to add one (Logjam Web).
    importFile: "Import a file",
  },
} as const satisfies ScreenContract;
