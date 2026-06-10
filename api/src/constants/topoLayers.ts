/**
 * Thin re-export — the canonical TOPO_LAYERS list lives in
 * shared/src/topoSettings.ts (ARCH-010). Kept so existing
 * `../constants/topoLayers` importers need no churn.
 *
 * The only remaining mirror is topo/worker.py → ALL_LAYERS (Python).
 */
export { TOPO_LAYERS } from "@logjam/shared";
export type { TopoLayerMeta, TopoLayerName, TopoLayerFormat } from "@logjam/shared";
