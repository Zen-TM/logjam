/**
 * Canonical list of master topo layer types.
 *
 * Keep in sync with:
 *   - topo/worker.py          → MASTER_LAYERS
 *   - frontend/src/topoLayerTypes.ts
 */
export const MASTER_TOPO_LAYERS = [
  { name: "hillshade", label: "Hillshade", format: "raster" },
  { name: "vegetation", label: "Vegetation", format: "raster" },
  { name: "slope", label: "Slope", format: "raster" },
  { name: "contours", label: "Contours", format: "vector" },
  { name: "features", label: "Features", format: "vector" },
] as const;

export type MasterTopoLayer = (typeof MASTER_TOPO_LAYERS)[number];
export type MasterTopoLayerName = MasterTopoLayer["name"];
export type TopoLayerFormat = "raster" | "vector";
