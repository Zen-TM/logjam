// Stage 2 — on-demand export pipeline shared types and compatibility matrix.
//
// Both API validation and frontend dialog disable/enable logic read from
// EXPORT_FORMAT_RULES below so the rules can only diverge in one place.

import { TOPO_LAYERS, type TopoLayerKey } from "./topoSettings.js";

export type ExportFormat = "mbtiles" | "geotiff" | "gpkg" | "geojson" | "gpx";
// KMZ is intentionally deferred (Stage 3) until Avenza-structure quirks are
// validated in user testing. Adding it later is purely additive.

export type ExportBundling = "composite" | "per-layer";

export type ExportStatus = "queued" | "running" | "completed" | "failed";

export const EXPORT_FORMATS: ExportFormat[] = ["mbtiles", "geotiff", "gpkg", "geojson", "gpx"];

// Derived from the canonical TOPO_LAYERS list (ARCH-010) so a new layer can
// never be missed here.
export const RASTER_LAYERS: TopoLayerKey[] = TOPO_LAYERS.filter(
  (l) => l.format === "raster",
).map((l) => l.name);
export const VECTOR_LAYERS: TopoLayerKey[] = TOPO_LAYERS.filter(
  (l) => l.format === "vector",
).map((l) => l.name);

export interface ExportFormatRule {
  format: ExportFormat;
  allowRaster: boolean;
  allowVector: boolean;
  allowComposite: boolean;
  allowPerLayer: boolean;
  // GPKG is inherently bundled; reject per-layer.
  // GeoJSON/GPX cannot composite (no raster pyramid concept).
  label: string;
  description: string;
}

export const EXPORT_FORMAT_RULES: Record<ExportFormat, ExportFormatRule> = {
  mbtiles: {
    format: "mbtiles",
    allowRaster: true,
    allowVector: true,
    allowComposite: true,
    allowPerLayer: true,
    label: "MBTiles",
    description: "Raster tile pyramid. Gaia GPS / Avenza-compatible. Vectors are rasterized into the pyramid.",
  },
  geotiff: {
    format: "geotiff",
    allowRaster: true,
    allowVector: false,
    allowComposite: true,
    allowPerLayer: true,
    label: "GeoTIFF",
    description: "Raster layers only. Per-layer is a direct copy of the stored COG; composite is rendered.",
  },
  gpkg: {
    format: "gpkg",
    allowRaster: true,
    allowVector: true,
    allowComposite: true,
    allowPerLayer: false,
    label: "GeoPackage",
    description: "QGIS-native single-file package. Vectors as feature tables; rasters as a tile pyramid.",
  },
  geojson: {
    format: "geojson",
    allowRaster: false,
    allowVector: true,
    allowComposite: false,
    allowPerLayer: true,
    label: "GeoJSON",
    description: "Vector layers only. One file per layer (ZIP if multiple).",
  },
  gpx: {
    format: "gpx",
    allowRaster: false,
    allowVector: true,
    allowComposite: false,
    allowPerLayer: true,
    label: "GPX",
    description: "Features layer only (lines + points). For Garmin / Basecamp.",
  },
};

export interface ExportValidationInput {
  format: ExportFormat;
  bundling: ExportBundling;
  layers: TopoLayerKey[];
}

export interface ExportValidationOk {
  ok: true;
}
export interface ExportValidationFail {
  ok: false;
  error: string;
}
export type ExportValidationResult = ExportValidationOk | ExportValidationFail;

export function validateExportRequest(input: ExportValidationInput): ExportValidationResult {
  const rule = EXPORT_FORMAT_RULES[input.format];
  if (!rule) return { ok: false, error: `unknown format: ${input.format}` };

  if (input.layers.length === 0) {
    return { ok: false, error: "at least one layer is required" };
  }

  const hasRaster = input.layers.some((l) => RASTER_LAYERS.includes(l));
  const hasVector = input.layers.some((l) => VECTOR_LAYERS.includes(l));
  if (hasRaster && !rule.allowRaster) {
    return { ok: false, error: `${rule.label} does not support raster layers` };
  }
  if (hasVector && !rule.allowVector) {
    return { ok: false, error: `${rule.label} does not support vector layers` };
  }

  if (input.bundling === "composite" && !rule.allowComposite) {
    return { ok: false, error: `${rule.label} cannot be composited` };
  }
  if (input.bundling === "per-layer" && !rule.allowPerLayer) {
    return { ok: false, error: `${rule.label} cannot be bundled per-layer` };
  }

  return { ok: true };
}

// Server-side type for a TopoExportJob row returned to the client. Mirrors
// the Prisma model but with serializable dates and the BigInt cast away.
export interface TopoExportJobView {
  id: string;
  sourceJobIds: string[];
  layers: TopoLayerKey[];
  format: ExportFormat;
  bundling: ExportBundling;
  status: ExportStatus;
  resultBytes: number | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  downloadUrl: string | null;   // presigned, set only when status=completed
  downloadExpiresAt: string | null;
}
