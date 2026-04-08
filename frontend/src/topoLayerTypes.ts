/**
 * Master topo layer types — shared frontend constant.
 *
 * Canonical source: api/src/constants/topoLayers.ts — keep in sync.
 * Also mirrored in: topo/worker.py → MASTER_LAYERS
 */
export const MASTER_TOPO_LAYERS = [
  { name: "hillshade", label: "Hillshade", format: "raster" },
  { name: "vegetation", label: "Vegetation", format: "raster" },
  { name: "slope", label: "Slope", format: "raster" },
  { name: "contours", label: "Contours", format: "vector" },
  { name: "features", label: "Features", format: "vector" },
] as const;

export type MasterTopoLayerName = (typeof MASTER_TOPO_LAYERS)[number]["name"];
export type TopoLayerFormat = "raster" | "vector";
