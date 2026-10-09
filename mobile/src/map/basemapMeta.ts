// The basemap picker's list and default.
//
// A basemap has no glyph of its own: they are not kinds of thing but renderings
// of the same thing, and the layer sheet leads each with a real sample tile
// (`BasemapThumb`), which says more than any icon can. Where there is no tile
// (the vector source, offline) the fallback is the `map` idea.

import type { BasemapId } from "./sourceResolver";

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
