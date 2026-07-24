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

import type { LogicalLayerRef, MapArtifact } from "./sourceResolver";

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
 * Union the online completed-overlays list with the downloaded topo-overlay
 * artifacts on disk, so a saved overlay is listed/rendered even on a cold
 * offline launch (when the online fetch returns nothing — it has no
 * persistence). Online jobs win for keys they cover (they carry the real name +
 * presigned URL for the Save affordance); saved-only overlays become synthetic
 * jobs whose layers have an empty `pmtilesUrl` (the resolver serves them from
 * the local artifact and ignores the URL). `downloadedAt` stands in for
 * `createdAt` so synthetic jobs still sort into the newest-first z-order.
 */
export function mergeSavedOverlayJobs(
  response: CompletedOverlaysResponse | null,
  artifacts: MapArtifact[],
): CompletedOverlaysResponse {
  const jobs = (response?.jobs ?? []).map((job) => ({
    ...job,
    layers: [...job.layers],
  }));
  const jobById = new Map(jobs.map((job) => [job.jobId, job]));
  const coveredKeys = new Set(
    jobs.flatMap((job) => job.layers.map((l) => `${job.jobId}/${l.name}`)),
  );

  for (const artifact of artifacts) {
    if (artifact.kind !== "topo-overlay") continue;
    if (coveredKeys.has(artifact.logicalKey)) continue;
    const slash = artifact.logicalKey.indexOf("/");
    if (slash < 0) continue;
    const jobId = artifact.logicalKey.slice(0, slash);
    const layer = {
      name: artifact.logicalKey.slice(slash + 1) as TopoLayerName,
      format: artifact.sourceType as TopoLayerFormat,
      pmtilesUrl: "",
    };
    coveredKeys.add(artifact.logicalKey);
    const existing = jobById.get(jobId);
    if (existing) {
      existing.layers.push(layer);
    } else {
      const job = {
        jobId,
        name: null,
        createdAt: artifact.downloadedAt,
        layers: [layer],
      };
      jobById.set(jobId, job);
      jobs.push(job);
    }
  }

  return { jobs, expiresAt: response?.expiresAt ?? "" };
}

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
