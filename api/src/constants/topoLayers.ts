/**
 * Canonical list of topo layer types that are rendered on the map and selectable
 * as GeoPDF overlays. Composite is intentionally absent — it's MBTiles-only
 * (email download), not a map layer.
 *
 * Keep in sync with:
 *   - topo/worker.py          → ALL_LAYERS
 *   - frontend/src/topoLayerTypes.ts
 */
export const TOPO_LAYERS = [
  { name: "hillshade", label: "Hillshade", format: "raster" },
  { name: "vegetation", label: "Vegetation", format: "raster" },
  { name: "slope", label: "Slope", format: "raster" },
  { name: "contours", label: "Contours", format: "vector" },
  { name: "features", label: "Features", format: "vector" },
] as const;

export type TopoLayerMeta = (typeof TOPO_LAYERS)[number];
export type TopoLayerName = TopoLayerMeta["name"];
export type TopoLayerFormat = "raster" | "vector";
