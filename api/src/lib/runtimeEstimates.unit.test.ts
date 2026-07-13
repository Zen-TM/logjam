import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../services/prisma", () => ({
  default: {
    topoExportJob: { findMany: vi.fn() },
    geoPdfJob: { findMany: vi.fn() },
  },
}));

import prisma from "../services/prisma";
import { estimateExportSeconds, estimateGeoPdfSeconds } from "./runtimeEstimates";
import { geoPdfNativeMegapixels } from "../services/geoPdfTileMath";
import type { GeoPdfConfig } from "@logjam/shared";

const exportFindMany = (
  prisma as unknown as { topoExportJob: { findMany: Mock } }
).topoExportJob.findMany;
const geoPdfFindMany = (
  prisma as unknown as { geoPdfJob: { findMany: Mock } }
).geoPdfJob.findMany;

// Env defaults (vitest.unit.setup.ts leaves these unset, so the zod schema
// defaults apply): TOPO_EXPORT_ESTIMATE_DEFAULT_SECONDS_PER_TILE=20,
// TOPO_EXPORT_ESTIMATE_MIN_SAMPLES=3, GEO_PDF_ESTIMATE_DEFAULT_SECONDS_PER_MEGAPIXEL=6,
// GEO_PDF_ESTIMATE_MIN_SAMPLES=3. Overheads are the module's own constants:
// 30s (export), 15s (GeoPDF).
const EXPORT_DEFAULT_RATE = 20;
const EXPORT_MIN_SAMPLES = 3;
const EXPORT_OVERHEAD_SECONDS = 30;
const GEO_PDF_DEFAULT_RATE = 6;
const GEO_PDF_OVERHEAD_SECONDS = 15;

const START = new Date("2026-07-01T00:00:00Z");
function completedAfter(seconds: number): Date {
  return new Date(START.getTime() + seconds * 1000);
}

describe("estimateExportSeconds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when sourceTileCount is null", async () => {
    const result = await estimateExportSeconds("mbtiles", "composite", null);
    expect(result).toBeNull();
    expect(exportFindMany).not.toHaveBeenCalled();
  });

  it("returns null when sourceTileCount is 0", async () => {
    const result = await estimateExportSeconds("mbtiles", "composite", 0);
    expect(result).toBeNull();
    expect(exportFindMany).not.toHaveBeenCalled();
  });

  it("queries history bucketed by (format, bundling, completed, non-null fields)", async () => {
    exportFindMany.mockResolvedValueOnce([]);
    await estimateExportSeconds("geotiff", "per-layer", 10);
    expect(exportFindMany).toHaveBeenCalledWith({
      where: {
        status: "completed",
        format: "geotiff",
        bundling: "per-layer",
        sourceTileCount: { not: null },
        startedAt: { not: null },
        completedAt: { not: null },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { sourceTileCount: true, startedAt: true, completedAt: true },
    });
  });

  it("uses the cold-start default rate below minSamples", async () => {
    // Only 2 usable samples — below EXPORT_MIN_SAMPLES (3) — falls back to the
    // configured default rate regardless of their actual (very different) rates.
    expect(EXPORT_MIN_SAMPLES).toBe(3);
    exportFindMany.mockResolvedValueOnce([
      { sourceTileCount: 10, startedAt: START, completedAt: completedAfter(100) },
      { sourceTileCount: 5, startedAt: START, completedAt: completedAfter(500) },
    ]);

    const tileCount = 10;
    const result = await estimateExportSeconds("mbtiles", "composite", tileCount);

    expect(result).toBe(EXPORT_OVERHEAD_SECONDS + EXPORT_DEFAULT_RATE * tileCount);
  });

  it("uses the fitted median rate at >= minSamples", async () => {
    // Rates: 100/10=10, 300/20=15, 100/5=20 -> median 15 s/tile.
    exportFindMany.mockResolvedValueOnce([
      { sourceTileCount: 10, startedAt: START, completedAt: completedAfter(100) },
      { sourceTileCount: 20, startedAt: START, completedAt: completedAfter(300) },
      { sourceTileCount: 5, startedAt: START, completedAt: completedAfter(100) },
    ]);

    const tileCount = 20;
    const result = await estimateExportSeconds("mbtiles", "composite", tileCount);

    expect(result).toBe(EXPORT_OVERHEAD_SECONDS + 15 * tileCount);
  });

  it("derives wallSeconds from completedAt - startedAt", async () => {
    // A single distinguishing sample: if wallSeconds were computed wrong
    // (e.g. always 0, or using a different timestamp pair), the fitted rate
    // at >= minSamples would not match this expected value.
    exportFindMany.mockResolvedValueOnce([
      { sourceTileCount: 4, startedAt: START, completedAt: completedAfter(40) }, // rate 10
      { sourceTileCount: 4, startedAt: START, completedAt: completedAfter(40) }, // rate 10
      { sourceTileCount: 4, startedAt: START, completedAt: completedAfter(40) }, // rate 10
    ]);

    const result = await estimateExportSeconds("mbtiles", "composite", 8);

    expect(result).toBe(EXPORT_OVERHEAD_SECONDS + 10 * 8);
  });
});

describe("estimateGeoPdfSeconds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const config: GeoPdfConfig = {
    paperSize: "A3",
    orientation: "landscape",
    extent: { north: -33.65, south: -33.7, east: 150.3, west: 150.25 },
    scale: 25000,
    baseLayer: "no-such-layer",
    overlays: [],
    elements: { compass: true, scaleText: true, scaleBar: true },
  };

  it("uses the cold-start default rate below minSamples", async () => {
    geoPdfFindMany.mockResolvedValueOnce([]); // no history at all
    const mp = geoPdfNativeMegapixels(config.extent, config.scale, 18);

    const result = await estimateGeoPdfSeconds(config);

    expect(result).toBe(Math.round(GEO_PDF_OVERHEAD_SECONDS + GEO_PDF_DEFAULT_RATE * mp));
  });

  it("skips malformed/legacy history rows without throwing", async () => {
    geoPdfFindMany.mockResolvedValueOnce([
      // Legacy row: config missing `extent` entirely.
      { config: { paperSize: "A4" }, startedAt: START, completedAt: completedAfter(60) },
      // Legacy row: scale is not a number.
      {
        config: { ...config, scale: "not-a-number" },
        startedAt: START,
        completedAt: completedAfter(60),
      },
    ]);

    const result = await estimateGeoPdfSeconds(config);
    expect(typeof result).toBe("number");
    expect(Number.isFinite(result)).toBe(true);
  });
});
