// The vector basemap's own colours, for the layer picker's swatch.
//
// Its own module rather than an export from Map.tsx: sidebar panels are
// forbidden from importing the map component (panels/CLAUDE.md), and a palette
// is not map machinery anyway.
//
// Read from the style's flavor rather than hand-picked, so the swatch cannot
// drift from what the map actually renders.
import { namedFlavor } from "@protomaps/basemaps";

const flavor = namedFlavor("light") as unknown as Record<string, string>;

export const PROTOMAPS_SWATCH = {
  earth: flavor.earth,
  water: flavor.water,
  road: flavor.major,
  minor: flavor.minor_a,
};
