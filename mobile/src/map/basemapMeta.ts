// Per-basemap identity for the layer picker and the download screen.
//
// ONE hue for all of them, and glyphs to tell them apart (DESIGN.md §3, the
// "a hub menu is not a category vocabulary" rule read across): these are not
// kinds of thing, they are seven renderings of the same thing, so seven hues
// would be decoration. The identity that matters here is "basemap", which wears
// the region hue — the class of asset a downloaded basemap becomes.
//
// There is no blurb any more: the layer sheet leads each basemap with a real
// sample tile, which says what the map looks like better than a sentence could,
// and six sentences on six rows was a paragraph between the user and a choice
// they make by eye.
//
// The glyph is now the FALLBACK identity: the layer sheet leads each basemap
// with a real sample tile (`BasemapThumb`), which says more than any icon can,
// and drops back to this glyph for the vector source and when offline.
import type { Feather } from "@expo/vector-icons";

import type { BasemapId } from "./sourceResolver";

export type BasemapMeta = {
  icon: React.ComponentProps<typeof Feather>["name"];
};

export const BASEMAP_META: Record<BasemapId, BasemapMeta> = {
  "six-topo": { icon: "map" },
  "six-base": { icon: "git-branch" },
  "six-imagery": { icon: "image" },
  protomaps: { icon: "layers" },
  "osm-topo": { icon: "trending-up" },
  "osm-cycle": { icon: "navigation-2" },
};

/**
 * The picker's order, and the whole of what mobile offers — NOT derived from
 * BASEMAP_CATALOG, which also carries the web-only "osm" raster (the same
 * OpenStreetMap cartography as `protomaps`, fetched instead of drawn, and
 * online-only). Two rows of the same map, one of which can't be saved, is a
 * choice with no answer, so mobile lists the drawn one only.
 *
 * OSM family first, then the SIX rasters: the OSM ones are the general-purpose
 * maps you open on, and the SIX sheets are what you switch to for the ground.
 */
export const MOBILE_BASEMAPS: BasemapId[] = [
  "protomaps",
  "osm-topo",
  "osm-cycle",
  "six-topo",
  "six-base",
  "six-imagery",
];

/** Shown until the user has picked one (and when a stored pick is unreadable). */
export const DEFAULT_BASEMAP: BasemapId = "six-topo";
