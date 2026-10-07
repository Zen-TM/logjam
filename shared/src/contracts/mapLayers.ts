// The map's layers: Logjam Web's `map/LayersPopover.tsx` and Logjam GPS's
// `map/MapLayersSheet.tsx`, the one surface that sits over the map (§1: the
// map is the main thing, so this is for choosing, not for reading).
//
// What each client lists INSIDE its overlays pane is not declared here: Logjam
// GPS draws every kind of line its phone holds (routes, imported ways, tracks)
// and GeoPDFs as rows of their own, Logjam Web draws one "Ways" row. That is a
// difference in what the two hold, listed in the Phase 5 report, not settled by
// words.
import type { ScreenContract } from "./types.js";

export const MAP_LAYERS = {
  id: "map.layers",
  title: "Map layers",
  sections: [
    { key: "basemap" },
    { key: "overlays" },
    {
      key: "offline",
      on: "gps",
      reason:
        "Saved maps and 'offline maps only' are phone features: Logjam Web is never used without a connection.",
    },
  ],
  copy: {
    tabBasemap: "Basemap",
    tabOverlays: "Overlays",
    tabOffline: "Offline",
    places: "Places",
    ways: "Ways",
    lidarTopos: "LiDAR topos",
    // The overlays list ends with the way to add one.
    importFile: "Import a file",
  },
} as const satisfies ScreenContract;
