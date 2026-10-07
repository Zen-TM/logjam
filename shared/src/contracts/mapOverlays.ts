// The map's Overlays list: the rows of the layers sheet's (Logjam GPS) and
// popover's (Logjam Web) Overlays tab, in order. Logjam Web's rows are the
// list; Logjam GPS draws the same ones and may refine a row with sub-switches
// under it, declared below, each saying what it refines.
//
// A row's switch draws or hides that kind of thing on the map. Whose a thing is
// never splits a row: "mine" and "shared with me" are the same kind of thing
// drawn the same way, and the pin itself says whose it is.
import { MAP_LAYERS } from "./mapLayers.js";
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
        "A GeoPDF is imported onto the phone and drawn by its own switch there; Logjam Web draws them from its Maps panel.",
    },
    { key: "lidarTopos" },
    { key: "importFile" },
  ],
  copy: {
    places: MAP_LAYERS.copy.places,
    ways: MAP_LAYERS.copy.ways,
    geoPdfs: "GeoPDF maps",
    lidarTopos: MAP_LAYERS.copy.lidarTopos,
    importFile: MAP_LAYERS.copy.importFile,
  },
} as const satisfies ScreenContract;

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
