// The basemap picker's list and default.
//
// A basemap has no glyph of its own: they are not kinds of thing but renderings
// of the same thing, and the layer sheet leads each with a real sample tile
// (`BasemapThumb`), which says more than any icon can. Where there is no tile
// (the vector source, offline) the fallback is the `map` idea.

import {
  basemapHere,
  BASEMAP_CATALOG,
  defaultBasemapFor,
  offeredBasemaps,
  type LonLatBox,
} from "@logjam/shared";

import type { BasemapId } from "./sourceResolver";

/**
 * What the picker lists for the ground a map shows, in the catalogue's order:
 * the worldwide maps, then those of each region the view touches (ADR 0049).
 * The catalogue leaves out the Logjam Web-only "osm" raster (`offered: false`):
 * the same cartography as `protomaps`, fetched instead of drawn and
 * online-only, so two rows of one map with one that can't be saved. Guard:
 * basemapMeta.test.ts, that every id offered is one the resolver draws.
 */
export const mobileBasemaps = (view: LonLatBox): BasemapId[] =>
  offeredBasemaps(view).map((entry) => entry.id);

/** Every id a picker lists somewhere: the ids a stored pick may name. */
export const knownBasemaps = (): BasemapId[] =>
  BASEMAP_CATALOG.filter((entry) => entry.offered !== false).map(
    (entry) => entry.id,
  );

/** Shown until the user has picked one (and when a stored pick is unreadable). */
export const defaultBasemap = (regionIds: readonly string[]): BasemapId =>
  defaultBasemapFor(regionIds);

/**
 * The basemap to use now: the stored pick while the view offers it, else the
 * default of the region in view. The pick itself is left alone, so a map
 * returning to ground that offers it brings it back. Guard: basemapMeta.test.ts.
 */
export const effectiveBasemap = (
  picked: BasemapId,
  view: LonLatBox,
): BasemapId => basemapHere(picked, view);

/**
 * The view a map offers basemaps for: the bounds of its last settle, a
 * `[west, south, east, north]` as MapLibre reports them, or `start` before the
 * first. Guard: basemapMeta.test.ts.
 */
export const settledView = (
  bounds: readonly number[] | null,
  start: LonLatBox,
): LonLatBox =>
  bounds
    ? {
        west: bounds[0]!,
        south: bounds[1]!,
        east: bounds[2]!,
        north: bounds[3]!,
      }
    : start;
