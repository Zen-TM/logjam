// Per-basemap identity for the layer picker and the download screen.
//
// ONE hue for all of them, and glyphs to tell them apart (DESIGN.md §3, the
// "a hub menu is not a category vocabulary" rule read across): these are not
// kinds of thing, they are seven renderings of the same thing, so seven hues
// would be decoration. The identity that matters here is "basemap", which wears
// the region hue — the class of asset a downloaded basemap becomes.
//
// The blurb is what a name can't say. "SIX Maps Topo" means nothing to someone
// who has not used it; "the printed NSW topo sheets" does.
//
// The glyph is now the FALLBACK identity: the layer sheet leads each basemap
// with a real sample tile (`BasemapThumb`), which says more than any icon can,
// and drops back to this glyph for the vector source and when offline.
import type { Feather } from "@expo/vector-icons";

import type { BasemapId } from "./sourceResolver";

export type BasemapMeta = {
  icon: React.ComponentProps<typeof Feather>["name"];
  blurb: string;
};

export const BASEMAP_META: Record<BasemapId, BasemapMeta> = {
  "six-topo": { icon: "map", blurb: "The printed NSW topo sheets" },
  "six-base": { icon: "git-branch", blurb: "Roads, tracks and labels" },
  "six-imagery": { icon: "image", blurb: "Aerial photography" },
  protomaps: {
    icon: "layers",
    blurb: "OpenStreetMap roads and tracks, drawn on the phone",
  },
  osm: { icon: "globe", blurb: "OpenStreetMap" },
  "osm-topo": { icon: "trending-up", blurb: "OpenTopoMap contours" },
  "osm-cycle": { icon: "navigation-2", blurb: "CyclOSM tracks and trails" },
};
