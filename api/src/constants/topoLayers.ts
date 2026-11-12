/**
 * Thin re-export — the canonical TOPO_LAYERS list lives in
 * shared/src/topoSettings.ts. Kept so existing
 * `../constants/topoLayers` importers need no churn.
 */
export { TOPO_LAYERS } from "@logjam/shared";
export type {
  TopoLayerMeta,
  TopoLayerName,
  TopoLayerFormat,
} from "@logjam/shared";
