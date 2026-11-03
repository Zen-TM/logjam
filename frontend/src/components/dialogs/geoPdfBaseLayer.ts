import { VALID_GEOPDF_BASE_LAYERS } from "@logjam/shared";
import { BASE_LAYERS } from "../map/Map";

// The base layer a GeoPDF is printed from, and what the map shows while the
// area is framed (shared/DESIGN.md §11: a preview shows the result as it will be
// made). Kept out of `GeoPdfDialog.tsx` so App can ask the same questions the
// dialog does without importing a component for its helpers.

// The map's basemaps a provider's tile terms let us print: each refusal says
// why on its entry in BASEMAP_CATALOG (`printable`).
export const PRINTABLE_BASE_LAYERS = BASE_LAYERS.filter((layer) =>
  VALID_GEOPDF_BASE_LAYERS.has(layer.id),
);

const FALLBACK_BASE_LAYER = "six-topo";

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
 * The base layer to open with, given whatever the map is showing. The map's own
 * layer is kept when this form can honour it (what was printed last time does
 * not outrank what is on screen), then the last one printed, then the
 * fallback — asking the LIST rather than testing the id's prefix, which is
 * what makes this hold for a basemap added later.
 */
export function seedBaseLayer(
  activeLayerId: string,
  lastPrinted?: string,
): string {
  const printable = (id: string | undefined) =>
    PRINTABLE_BASE_LAYERS.some((layer) => layer.id === id);
  return printable(activeLayerId)
    ? activeLayerId
    : printable(lastPrinted)
      ? lastPrinted!
      : FALLBACK_BASE_LAYER;
}
