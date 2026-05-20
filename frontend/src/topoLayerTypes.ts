/**
 * Topo layer types — shared frontend constant.
 *
 * Canonical source: api/src/constants/topoLayers.ts — keep in sync.
 * Also mirrored in: topo/worker.py → ALL_LAYERS
 *
 * Composite is intentionally absent — it's MBTiles-only (email download),
 * not a map layer.
 */
export const TOPO_LAYERS = [
  { name: "hillshade", label: "Hillshade", format: "raster" },
  { name: "vegetation", label: "Vegetation", format: "raster" },
  { name: "slope", label: "Slope", format: "raster" },
  { name: "contours", label: "Contours", format: "vector" },
  { name: "features", label: "Features", format: "vector" },
] as const;

export type TopoLayerName = (typeof TOPO_LAYERS)[number]["name"];
export type TopoLayerFormat = "raster" | "vector";

/** A polygon footprint as returned in GeoJSON form by the topo-jobs API. */
export type GeoJsonGeometry = {
  type: string;
  coordinates: unknown;
};

/** Per-completed-job overlay payload returned by GET /topo-jobs/completed-overlays. */
export type CompletedTopoJob = {
  jobId: string;
  name: string | null;
  createdAt: string;
  footprint: GeoJsonGeometry | null;
  layers: { name: TopoLayerName; format: TopoLayerFormat; pmtilesUrl: string }[];
};

/** Response shape from GET /topo-jobs/completed-overlays. Includes presigned-URL expiry so the client can pre-refetch. */
export type CompletedOverlaysResponse = {
  jobs: CompletedTopoJob[];
  expiresAt: string;
};
