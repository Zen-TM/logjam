import { BASE_LAYERS } from "../map/Map";
import type { ChipOption } from "../../ui";

// The base layer a GeoPDF is printed from, and what the map shows while the
// area is framed (shared/DESIGN.md §11: a preview shows the result as it will be
// made). Kept out of `GeoPdfDialog.tsx` so App can ask the same questions the
// dialog does without importing a component for its helpers.

// Raster only — the renderer fetches XYZ tiles, which a vector PMTiles archive
// cannot provide.
export const BASE_LAYER_OPTIONS: ChipOption<string>[] = BASE_LAYERS.filter(
  (layer) =>
    layer.kind === "raster" &&
    !layer.id.startsWith("osm") &&
    layer.id !== "six-base",
).map((layer) => ({ value: layer.id, label: layer.name }));

const FALLBACK_BASE_LAYER = "six-topo";

/**
 * The base layer to open with, given whatever the map is showing. The map's own
 * layer is kept when this form can honour it, and otherwise the fallback is —
 * asking the LIST rather than testing the id's prefix, which is what makes this
 * hold for a basemap added later.
 */
export function seedBaseLayer(activeLayerId: string): string {
  return BASE_LAYER_OPTIONS.some((option) => option.value === activeLayerId)
    ? activeLayerId
    : FALLBACK_BASE_LAYER;
}
