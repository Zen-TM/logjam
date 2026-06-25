/**
 * Topo layer constants — thin re-export. The canonical TOPO_LAYERS list lives
 * in shared/src/topoSettings.ts (ARCH-010); the only remaining mirror is
 * topo/worker.py → ALL_LAYERS (Python). The view types below are
 * frontend-local.
 */
export { TOPO_LAYERS } from "@logjam/shared";
export type { TopoLayerName, TopoLayerFormat } from "@logjam/shared";

import type { TopoLayerName, TopoLayerFormat } from "@logjam/shared";

/**
 * A topo-job footprint as returned in GeoJSON form by the topo-jobs API.
 *
 * The pipeline derives a footprint by `unary_union`-ing the per-tile coverage
 * masks, which yields a **Polygon** for a contiguous capture or a
 * **MultiPolygon** for a disconnected one — never any other geometry. Modelling
 * it as a discriminated union (rather than a bare `coordinates: number[][][]`,
 * which silently lied for MultiPolygons) forces every consumer to narrow on
 * `type` before indexing `coordinates`, so a Polygon-only assumption fails at
 * compile time instead of producing NaN bounds at runtime.
 */
export type GeoJsonPolygon = {
  type: "Polygon";
  coordinates: number[][][];
};
export type GeoJsonMultiPolygon = {
  type: "MultiPolygon";
  coordinates: number[][][][];
};
export type GeoJsonPolygonal = GeoJsonPolygon | GeoJsonMultiPolygon;

/** Per-completed-job overlay payload returned by GET /topo-jobs/completed-overlays. */
export type CompletedTopoJob = {
  jobId: string;
  name: string | null;
  createdAt: string;
  footprint: GeoJsonPolygonal | null;
  layers: { name: TopoLayerName; format: TopoLayerFormat; pmtilesUrl: string }[];
};

/** Response shape from GET /topo-jobs/completed-overlays. Includes presigned-URL expiry so the client can pre-refetch. */
export type CompletedOverlaysResponse = {
  jobs: CompletedTopoJob[];
  expiresAt: string;
};
