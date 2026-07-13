// Adaptive runtime estimators for topo exports and GeoPDF jobs. Mirrors
// computeEstimatedSeconds in routes/topoJobs.ts: fit a per-unit rate from
// recent completed jobs' actual runtimes, falling back to a configurable
// cold-start default below a minimum-samples threshold, so the estimate
// self-corrects as the pipeline's performance changes.
//
// Privacy: reads only aggregate timings + sizes (tile counts, render
// megapixels) across jobs — never canyon names, coordinates, or footprints.

import prisma from "../services/prisma";
import { getEnv } from "./env";
import { logger } from "./logger";
import { geoPdfNativeMegapixels } from "../services/geoPdfTileMath";
import {
  estimateRuntimeSeconds,
  GEOPDF_BASE_LAYER_CONFIG,
  type JobActual,
  type GeoPdfConfig,
} from "@logjam/shared";

const env = getEnv();

// Fixed per-job floor added on top of the fitted rate term.
const EXPORT_OVERHEAD_SECONDS = 30; // task launch + S3 shuffle floor
const GEO_PDF_OVERHEAD_SECONDS = 15; // task launch + S3 shuffle floor

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
    const wallSeconds = (row.completedAt.getTime() - row.startedAt.getTime()) / 1000;
    if (wallSeconds > 0) {
      actuals.push({ inputTileCount: row.sourceTileCount, wallSeconds });
    }
  }

  return estimateRuntimeSeconds(actuals, sourceTileCount, {
    defaultSecondsPerInputTile: env.TOPO_EXPORT_ESTIMATE_DEFAULT_SECONDS_PER_TILE,
    minSamples: env.TOPO_EXPORT_ESTIMATE_MIN_SAMPLES,
    overheadSeconds: EXPORT_OVERHEAD_SECONDS,
  });
}

/**
 * Adaptive processing-time estimate (seconds) for a GeoPDF render of the given
 * config. Sized by native render-canvas megapixels (paper-independent — see
 * geoPdfNativeMegapixels), the only size signal known at submit time.
 */
export async function estimateGeoPdfSeconds(config: GeoPdfConfig): Promise<number | null> {
  const maxNativeZoom = GEOPDF_BASE_LAYER_CONFIG[config.baseLayer]?.maxNativeZoom ?? 18;
  const megapixels = geoPdfNativeMegapixels(config.extent, config.scale, maxNativeZoom);

  const recent = await prisma.geoPdfJob.findMany({
    where: {
      status: "completed",
      startedAt: { not: null },
      completedAt: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      config: true,
      startedAt: true,
      completedAt: true,
    },
  });

  const actuals: JobActual[] = [];
  for (const row of recent) {
    if (!row.startedAt || !row.completedAt) continue;
    const wallSeconds = (row.completedAt.getTime() - row.startedAt.getTime()) / 1000;
    if (!(wallSeconds > 0)) continue;
    try {
      const rowConfig = row.config as unknown as GeoPdfConfig;
      const rowMaxNativeZoom =
        GEOPDF_BASE_LAYER_CONFIG[rowConfig.baseLayer]?.maxNativeZoom ?? 18;
      const rowMegapixels = geoPdfNativeMegapixels(
        rowConfig.extent,
        rowConfig.scale,
        rowMaxNativeZoom,
      );
      if (!Number.isFinite(rowMegapixels) || rowMegapixels <= 0) continue;
      actuals.push({ inputTileCount: rowMegapixels, wallSeconds });
    } catch (err) {
      // Malformed/legacy stored config (missing/non-numeric extent or scale) —
      // skip this row rather than let one bad historical row break the estimate.
      logger.warn({ reason: String(err) }, "geo_pdf_estimate_history_row_skipped");
    }
  }

  return estimateRuntimeSeconds(actuals, megapixels, {
    defaultSecondsPerInputTile: env.GEO_PDF_ESTIMATE_DEFAULT_SECONDS_PER_MEGAPIXEL,
    minSamples: env.GEO_PDF_ESTIMATE_MIN_SAMPLES,
    overheadSeconds: GEO_PDF_OVERHEAD_SECONDS,
  });
}
