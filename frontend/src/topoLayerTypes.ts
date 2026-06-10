/**
 * Topo layer constants — thin re-export. The canonical TOPO_LAYERS list lives
 * in shared/src/topoSettings.ts (ARCH-010); the only remaining mirror is
 * topo/worker.py → ALL_LAYERS (Python). The view types below are
 * frontend-local.
 */
export { TOPO_LAYERS } from "@logjam/shared";
export type { TopoLayerName, TopoLayerFormat } from "@logjam/shared";

import type { TopoLayerName, TopoLayerFormat } from "@logjam/shared";

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
