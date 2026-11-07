// The basemap picker's list and default.
//
// A basemap has no glyph of its own: they are not kinds of thing but renderings
// of the same thing, and the layer sheet leads each with a real sample tile
// (`BasemapThumb`), which says more than any icon can. Where there is no tile
// (the vector source, offline) the fallback is the `map` idea.

import { defaultBasemapFor, offeredBasemaps } from "@logjam/shared";

import type { BasemapId } from "./sourceResolver";

/**
 * What the picker lists for these regions, in the catalogue's order: the worldwide
 * maps, then each chosen region's. The catalogue leaves out the Logjam
 * Web-only "osm" raster (`offered: false`): the same cartography as
 * `protomaps`, fetched instead of drawn and online-only, so two rows of one map
 * with one that can't be saved. Guard: basemapMeta.test.ts, that every id
 * offered is one the resolver draws.
 */
export const mobileBasemaps = (regionIds: readonly string[]): BasemapId[] =>
  offeredBasemaps(regionIds).map((entry) => entry.id as BasemapId);

/** Shown until the user has picked one (and when a stored pick is unreadable). */
export const defaultBasemap = (regionIds: readonly string[]): BasemapId =>
  defaultBasemapFor(regionIds) as BasemapId;
