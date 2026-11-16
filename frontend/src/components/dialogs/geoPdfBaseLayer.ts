import {
  basemapHere,
  pointBox,
  VALID_GEOPDF_BASE_LAYERS,
  offeredBasemaps,
  wrapLon,
  type LonLatBox,
} from "@logjam/shared";
import { BASE_LAYERS } from "../map/baseLayers";

// The base layer a GeoPDF is printed from, and what the map shows while the
// area is framed (shared/DESIGN.md §11: a preview shows the result as it will be
// made). Kept out of `GeoPdfDialog.tsx` so App can ask the same questions the
// dialog does without importing a component for its helpers.

// The map's basemaps a provider's tile terms let us print: each refusal says
// why on its entry in BASEMAP_CATALOG (`printable`). Wherever the sheet is:
// `printableBaseLayersFor` narrows it to the ground.
export const PRINTABLE_BASE_LAYERS = BASE_LAYERS.filter((layer) =>
  VALID_GEOPDF_BASE_LAYERS.has(layer.id),
);

const FALLBACK_BASE_LAYER = "six-topo";

/**
 * The ground a sheet covers: its area once that is set, else the point the
 * form was opened over, else null (no ground known: every basemap is listed).
 */
export function sheetBox(
  area: LonLatBox | null,
  centre: { lat: number; lng: number } | null | undefined,
): LonLatBox | null {
  return area ?? (centre ? pointBox(wrapLon(centre.lng), centre.lat) : null);
}

// The ids the ground offers (the map's own gallery, ADR 0049), or null for no ground.
const offeredIn = (box: LonLatBox | null) =>
  box ? new Set(offeredBasemaps(box).map((entry) => entry.id)) : null;

/**
 * The basemaps a sheet over `box` can be printed from: those the map's gallery
 * offers over that ground (a SIX tile exists in New South Wales only, the
 * vector map only where the region has an archive of it) whose provider's terms
 * allow a print. Guard: `geoPdfBaseLayer.test.ts`.
 */
export function printableBaseLayersFor(box: LonLatBox | null) {
  const offered = offeredIn(box);
  return PRINTABLE_BASE_LAYERS.filter(
    (layer) => !offered || offered.has(layer.id),
  );
}

/**
 * Why the map's picker offers a basemap this one does not, or null when it
 * offers none: the layers control and this list are one set otherwise.
 */
export const UNPRINTABLE_NOTE = (() => {
  const names = BASE_LAYERS.filter(
    (layer) => !PRINTABLE_BASE_LAYERS.includes(layer),
  ).map((layer) => layer.name);
  return names.length === 0
    ? null
    : `${names.join(" and ")} can't be printed: ${names.length === 1 ? "its" : "their"} tile server's policy forbids it.`;
})();

/**
 * The base layer a sheet over `box` is printed from: the pick where it can be
 * printed there, else the default the map's gallery would show over that ground
 * when that prints, else the first that does. The pick itself is left alone, so
 * it returns when the sheet is moved back (`basemapHere` does the same for the
 * map). Guard: `geoPdfBaseLayer.test.ts`.
 */
export function baseLayerHere(picked: string, box: LonLatBox | null): string {
  const here = printableBaseLayersFor(box).map((layer) => layer.id);
  if (here.includes(picked)) return picked;
  const gallery = box ? basemapHere("", box) : FALLBACK_BASE_LAYER;
  return here.includes(gallery) ? gallery : (here[0] ?? FALLBACK_BASE_LAYER);
}

/**
 * The base layer to open with, given whatever the map is showing. The map's own
 * layer is kept when this form can honour it over `box` (what was printed last
 * time does not outrank what is on screen), then the last one printed, then
 * `baseLayerHere`'s default — asking the LIST rather than testing the id's
 * prefix, which is what makes this hold for a basemap added later.
 */
export function seedBaseLayer(
  activeLayerId: string,
  box: LonLatBox | null,
  lastPrinted?: string,
): string {
  const here = printableBaseLayersFor(box).map((layer) => layer.id);
  return here.includes(activeLayerId)
    ? activeLayerId
    : lastPrinted && here.includes(lastPrinted)
      ? lastPrinted
      : baseLayerHere("", box);
}
