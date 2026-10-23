// Which LiDAR jobs the layers popover switches, and what its LiDAR row says
// when it has none to switch (lidarOverlays.test.ts).
import type { CompletedTopoJob } from "../../topoLayerTypes";

/**
 * The jobs that have an overlay to switch. A sharpened job with no
 * vegetation has none: its area is terrain, drawn by the Terrain group, so it
 * gets no switch.
 */
export function jobsWithOverlays(
  jobs: readonly CompletedTopoJob[],
): CompletedTopoJob[] {
  return jobs.filter((job) => job.layers.length > 0);
}

/**
 * The LiDAR row's line when no job has an overlay, or null when one does:
 * "none yet" only when there are no jobs at all, since a sharpened area is
 * there, drawn by the Terrain group.
 */
export function lidarOverlayEmptyLine(
  jobs: readonly CompletedTopoJob[],
): string | null {
  if (jobsWithOverlays(jobs).length > 0) return null;
  return jobs.length === 0
    ? "None yet. Make one from Maps."
    : "Sharpened areas draw in the Terrain group.";
}
