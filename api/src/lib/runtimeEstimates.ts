// Adaptive runtime estimators for the two worker pipelines: fit a per-unit
// rate from
// recent completed jobs' actual runtimes, falling back to a configurable
// cold-start default below a minimum-samples threshold, so the estimate
// self-corrects as the pipeline's performance changes.
//
// Privacy: reads only aggregate timings + sizes (tile counts, render
// megapixels) across jobs — never place names, coordinates, or footprints.

import { Prisma } from "@prisma/client";
import prisma from "../services/prisma";
import { getEnv } from "./env";
import { estimateRuntimeSeconds, type JobActual } from "@logjam/shared";

const env = getEnv();

// The cold-start rate, until enough jobs have run to fit one: sharpening one
// published Katoomba tile took 14 to 150 s (a 1 m DEM to a dense LAZ's TIN).
const SHARPEN_DEFAULT_SECONDS_PER_TILE = 150;

// Fixed per-job floor added on top of the fitted rate term.
const EXPORT_OVERHEAD_SECONDS = 30; // task launch + S3 shuffle floor

/**
 * Adaptive processing-time estimate (seconds) for a topo export of
 * `sourceTileCount` input tiles in the given (format, bundling) bucket.
 * Bucketed because per-tile cost differs wildly across export formats.
 */
export async function estimateExportSeconds(
  format: string,
  bundling: string,
  sourceTileCount: number | null,
): Promise<number | null> {
  if (!sourceTileCount) return null;

  const recent = await prisma.topoExportJob.findMany({
    where: {
      status: "completed",
      format,
      bundling,
      sourceTileCount: { not: null },
      startedAt: { not: null },
      completedAt: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      sourceTileCount: true,
      startedAt: true,
      completedAt: true,
    },
  });

  const actuals: JobActual[] = [];
  for (const row of recent) {
    if (!row.sourceTileCount || !row.startedAt || !row.completedAt) continue;
    const wallSeconds =
      (row.completedAt.getTime() - row.startedAt.getTime()) / 1000;
    if (wallSeconds > 0) {
      actuals.push({ inputTileCount: row.sourceTileCount, wallSeconds });
    }
  }

  return estimateRuntimeSeconds(actuals, sourceTileCount, {
    defaultSecondsPerInputTile:
      env.TOPO_EXPORT_ESTIMATE_DEFAULT_SECONDS_PER_TILE,
    minSamples: env.TOPO_EXPORT_ESTIMATE_MIN_SAMPLES,
    overheadSeconds: EXPORT_OVERHEAD_SECONDS,
  });
}

/**
 * Adaptive processing-time estimate (seconds) for a job of `inputTileCount`
 * ELVIS tiles. Fits a per-input-tile rate from recent completed jobs' real
 * runtimes (TopoJob.pipeline_metrics / startedAt→updatedAt), falling back to a
 * fixed cold-start rate below TOPO_ESTIMATE_MIN_SAMPLES so the estimate
 * self-corrects as the pipeline's performance changes.
 *
 * Privacy: reads only aggregate timing + tile counts across jobs — never place
 * names, coordinates, or footprints.
 */
export async function estimateTopoSeconds(
  inputTileCount: number | null,
): Promise<number | null> {
  if (!inputTileCount) return null;
  // Sharpened jobs only: an older job cost very differently per tile
  // (runtimeEstimates.unit.test.ts).
  const recent = await prisma.topoJob.findMany({
    where: {
      status: "complete",
      outputTileCount: { not: null },
      tileCount: { not: null },
      sharpen: { not: Prisma.DbNull },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      tileCount: true,
      outputTileCount: true,
      pipelineMetrics: true,
      startedAt: true,
      updatedAt: true,
    },
  });
  const actuals: JobActual[] = [];
  for (const job of recent) {
    if (!job.tileCount) continue;
    const metrics = job.pipelineMetrics as { wallSeconds?: number } | null;
    const wallSeconds =
      typeof metrics?.wallSeconds === "number"
        ? metrics.wallSeconds
        : job.startedAt
          ? (job.updatedAt.getTime() - job.startedAt.getTime()) / 1000
          : null;
    if (wallSeconds && wallSeconds > 0) {
      actuals.push({
        inputTileCount: job.tileCount,
        outputTileCount: job.outputTileCount ?? undefined,
        wallSeconds,
      });
    }
  }
  return estimateRuntimeSeconds(actuals, inputTileCount, {
    defaultSecondsPerInputTile: SHARPEN_DEFAULT_SECONDS_PER_TILE,
    minSamples: env.TOPO_ESTIMATE_MIN_SAMPLES,
  });
}
