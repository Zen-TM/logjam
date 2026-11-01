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
 * The base layer to open with, given whatever the map is showing. The map's own
 * layer is kept when this form can honour it, and otherwise the fallback is —
 * asking the LIST rather than testing the id's prefix, which is what makes this
 * hold for a basemap added later.
 */
export function seedBaseLayer(activeLayerId: string): string {
  return PRINTABLE_BASE_LAYERS.some((layer) => layer.id === activeLayerId)
    ? activeLayerId
    : FALLBACK_BASE_LAYER;
}
