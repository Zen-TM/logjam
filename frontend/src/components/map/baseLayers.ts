import {
  BASEMAP_CATALOG,
  offeredBasemaps,
  type BasemapCatalogEntry,
} from "@logjam/shared";

// Derived from the canonical shared basemap catalog (map-sources.md D2) —
// same ids, order, URLs, and zoom caps as before the consolidation. The
// interactive map uses displayMaxZoom (six-imagery stays capped at 18 here
// while the GeoPDF renderer keeps fetching its native 20).
//
// `kind` rides along because the two entry kinds are not interchangeable
// downstream: a raster entry is an XYZ template, the vector entry a PMTiles
// archive drawn from its style.
const toBaseLayer = (entry: BasemapCatalogEntry) => ({
  id: entry.id,
  name: entry.name,
  kind: entry.kind,
  // Vector has no XYZ template — `tiles` stays empty and the picker falls back
  // to a captioned placeholder instead of a tile thumbnail.
  tiles: entry.kind === "raster" ? [entry.urlTemplate] : [],
  maxzoom: entry.displayMaxZoom,
  attribution: entry.attributionHtml,
});

/** The gallery's basemaps for an account that chose `regionIds`. */
export const baseLayersFor = (regionIds: readonly string[]) =>
  offeredBasemaps(regionIds).map(toBaseLayer);

/**
 * The full offered catalogue, whatever the account chose, so every basemap
 * source stays mounted and the GeoPDF dialog lists them all. A stored pick no
 * longer in `baseLayersFor` falls back to the default (App.tsx).
 */
export const BASE_LAYERS = BASEMAP_CATALOG.filter(
  (entry) => entry.offered !== false,
).map(toBaseLayer);
