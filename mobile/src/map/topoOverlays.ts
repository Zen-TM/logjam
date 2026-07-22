// Compose the /topo-jobs/completed-overlays response into ordered
// LogicalLayerRefs — the mobile counterpart of the web's combinedTopoLayers
// (frontend/src/components/App.tsx): z-order is layer-order outer loop
// (TOPO_LAYERS order), newest-job-first inner loop. Pure; vitest-tested.
import {
  TOPO_LAYERS,
  overlayAttributionLines,
  type TopoLayerFormat,
  type TopoLayerName,
} from "@logjam/shared";

import type { LogicalLayerRef } from "./sourceResolver";

export type CompletedOverlaysResponse = {
  jobs: {
    jobId: string;
    name: string | null;
    createdAt: string;
    layers: { name: TopoLayerName; format: TopoLayerFormat; pmtilesUrl: string }[];
  }[];
  expiresAt: string;
};

export type TopoOverlayRef = Extract<LogicalLayerRef, { kind: "topo-overlay" }>;

/**
 * Flatten enabled job layers into resolver refs in render z-order (first =
 * bottom). `enabled` holds "<jobId>/<layerName>" keys; an empty set renders
 * nothing.
 */
export function composeTopoOverlayRefs(
  response: CompletedOverlaysResponse,
  enabled: ReadonlySet<string>,
): TopoOverlayRef[] {
  // Newest job first within each layer band (matches web).
  const jobsNewestFirst = [...response.jobs].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const refs: TopoOverlayRef[] = [];
  for (const layer of TOPO_LAYERS) {
    for (const job of jobsNewestFirst) {
      const match = job.layers.find((l) => l.name === layer.name);
      if (!match) continue;
      if (!enabled.has(`${job.jobId}/${layer.name}`)) continue;
      refs.push({
        kind: "topo-overlay",
        jobId: job.jobId,
        layer: layer.name,
        format: match.format,
        remoteUrl: match.pmtilesUrl,
        attribution: overlayAttributionLines([layer.name]).join(" "),
      });
    }
  }
  return refs;
}
