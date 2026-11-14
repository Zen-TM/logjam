import {
  BASEMAP_CATALOG,
  basemapHere,
  offeredBasemaps,
  type BasemapCatalogEntry,
  type LonLatBox,
} from "@logjam/shared";

// Derived from the canonical shared basemap catalog —
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

/** The gallery's basemaps for the ground a map shows (ADR 0049). */
export const baseLayersFor = (view: LonLatBox) =>
  offeredBasemaps(view).map(toBaseLayer);

const offerOf = (view: LonLatBox) =>
  [
    ...offeredBasemaps(view).map((entry) => entry.id),
    basemapHere("", view),
  ].join();

/**
 * `prev` while `next` lists the same basemaps and falls back to the same one,
 * else `next`: a view held in state this way changes only when the gallery
 * would, so a pan within one region redraws nothing for it.
 */
export const viewForBasemaps = (prev: LonLatBox, next: LonLatBox): LonLatBox =>
  offerOf(prev) === offerOf(next) ? prev : next;

/**
 * The full offered catalogue, wherever the map is, so every basemap source
 * stays mounted and the GeoPDF dialog lists them all. A stored pick not in
 * `baseLayersFor` shows `basemapHere`'s (App.tsx).
 */
export const BASE_LAYERS = BASEMAP_CATALOG.filter(
  (entry) => entry.offered !== false,
).map(toBaseLayer);
