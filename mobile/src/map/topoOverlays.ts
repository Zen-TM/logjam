// Compose the /topo-jobs/completed-overlays response into ordered
// LogicalLayerRefs — the Logjam GPS counterpart of Logjam Web's
// vegetationLayers (frontend/src/components/App.tsx). Pure; vitest-tested.
import {
  overlayAttributionLines,
  type TopoLayerFormat,
  type TopoLayerName,
  type SharpenedOverlay,
} from "@logjam/shared";

import type { LogicalLayerRef, MapArtifact } from "./sourceResolver";

export type CompletedOverlaysResponse = {
  jobs: {
    jobId: string;
    name: string | null;
    createdAt: string;
    /**
     * Owner or direct-share recipient, from the server.
     *
     * ABSENT on a synthetic job — one reconstructed from a downloaded artifact
     * when the online list is unavailable (see mergeSavedOverlayJobs). A cold
     * offline launch genuinely does not know who owns an overlay, and absent
     * means exactly that rather than guessing.
     *
     * So surfaces test for the NEGATIVE — `=== "shared"` withholds an
     * owner-only verb, unknown does not. Gating on `=== "owner"` would make
     * Share disappear from saved topos when offline, violating mobile/DESIGN.md;
     * the row is shown dimmed with its reason instead, and the verb needs the
     * network anyway.
     */
    syncRole?: "owner" | "shared";
    /** A sharpened job's area; absent while the job is still marked and on a synthetic one. */
    sharpened?: SharpenedOverlay;
    /** The ground the job covers, as the server sends it (absent on a synthetic job). */
    footprint?: { coordinates: unknown } | null;
    layers: {
      name: TopoLayerName;
      format: TopoLayerFormat;
      pmtilesUrl: string;
    }[];
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
    // Only a raster overlay draws now; an older vector one saved on the phone
    // stays on disk, unlisted, until the user deletes it.
    if (artifact.sourceType !== "raster") continue;
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
 * Flatten every job's vegetation layer into resolver refs in render z-order
 * (first = bottom): the only layer of a sharpened area that is an overlay, the
 * rest drawing through the Terrain group. Newest job first, matching web.
 */
export function composeTopoOverlayRefs(
  response: CompletedOverlaysResponse,
): TopoOverlayRef[] {
  const jobsNewestFirst = [...response.jobs].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  return jobsNewestFirst.flatMap((job) => {
    const match = job.layers.find((l) => l.name === "vegetation");
    if (!match || match.format !== "raster") return [];
    return [
      {
        kind: "topo-overlay" as const,
        jobId: job.jobId,
        layer: match.name,
        format: match.format,
        remoteUrl: match.pmtilesUrl,
        attribution: overlayAttributionLines([match.name]).join(" "),
      },
    ];
  });
}

/**
 * Credit lines for the overlays being drawn, deduped and in stable source
 * order — the same lines Logjam Web's attribution control shows. Hillshade,
 * slope, contours and vegetation all credit the LiDAR (ELVIS) source.
 */
export function topoOverlayCredits(refs: readonly TopoOverlayRef[]): string[] {
  return overlayAttributionLines(refs.map((ref) => ref.layer));
}
