// Stage 2 — on-demand export pipeline shared types and compatibility matrix.
//
// Both API validation and frontend dialog disable/enable logic read from
// EXPORT_FORMAT_RULES below so the rules can only diverge in one place.

import { TOPO_LAYERS, type TopoLayerKey } from "./topoSettings.js";
// Type-only import keeps the module dependency direction acyclic
// (topoExport → topoSettings); RasterTemplateSettings is erased at compile.
import type { RasterTemplateSettings, ValidationResult } from "./topoSettings.js";

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
  // When set, only these layers are exportable in this format, further
  // narrowing the raster/vector gates. GPX is features-only: the worker
  // (topo/renderers/gpx.py) renders points→waypoints/lines→routes from the
  // features GeoJSON and has no contour path (TOPOEXP-1).
  layerAllowlist?: TopoLayerKey[];
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
    description: "Raster tile pyramid. Gaia GPS-compatible. Vectors are rasterized into the pyramid.",
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
    layerAllowlist: ["features"],
    label: "GPX",
    description: "Features layer only (lines + points). For Garmin / Basecamp.",
  },
};

/**
 * Whether a layer may appear in an export of the given format. The single
 * eligibility predicate behind validateExportRequest, reconcileExportSelection
 * and the export dialog's checkbox enable/disable — keep every surface on this
 * so per-format layer rules can't drift (TOPOEXP-1).
 */
export function isLayerEligibleForFormat(
  format: ExportFormat,
  layer: TopoLayerKey,
): boolean {
  const rule = EXPORT_FORMAT_RULES[format];
  const meta = TOPO_LAYERS.find((m) => m.name === layer);
  if (!rule || !meta) return false;
  if (rule.layerAllowlist && !rule.layerAllowlist.includes(layer)) return false;
  return (
    (meta.format === "raster" && rule.allowRaster) ||
    (meta.format === "vector" && rule.allowVector)
  );
}

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
  if (rule.layerAllowlist) {
    const disallowed = input.layers.find((l) => !rule.layerAllowlist!.includes(l));
    if (disallowed) {
      const meta = TOPO_LAYERS.find((m) => m.name === disallowed);
      return {
        ok: false,
        error: `${rule.label} does not support the ${meta?.label ?? disallowed} layer`,
      };
    }
  }

  if (input.bundling === "composite" && !rule.allowComposite) {
    return { ok: false, error: `${rule.label} cannot be composited` };
  }
  if (input.bundling === "per-layer" && !rule.allowPerLayer) {
    return { ok: false, error: `${rule.label} cannot be bundled per-layer` };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Auto-export — a TopoExportJob the API queues automatically the moment its
// source TopoJob finishes. The user pre-configures it in the topo Advanced
// settings dialog; it is persisted alongside the topo job (TopoJob.autoExport)
// and on saved templates (TopoTemplate.autoExport). Same artefact and rules as
// a manual export — just deferred to completion. Lives here (not in
// topoSettings) so format/bundling/layer types and rules are reused without a
// circular import.
// ---------------------------------------------------------------------------

export interface AutoExportSettings {
  enabled: boolean; // master toggle; off by default
  format: ExportFormat;
  bundling: ExportBundling;
  layers: TopoLayerKey[]; // user's chosen subset (reconciled at completion)
}

export const AUTO_EXPORT_DEFAULTS: AutoExportSettings = {
  enabled: false,
  format: "mbtiles",
  bundling: "composite",
  layers: [...RASTER_LAYERS, ...VECTOR_LAYERS],
};

/**
 * The layers a topo job with these settings will actually produce. A layer is
 * present iff its slice is enabled. This is the pre-generation stand-in for
 * `job.layers` so the auto-export tab can offer the same layer choices the
 * export dialog would after the job completes.
 */
export function producedLayers(s: RasterTemplateSettings): TopoLayerKey[] {
  const out: TopoLayerKey[] = [];
  if (s.hillshade.enabled) out.push("hillshade");
  if (s.vegetation.enabled) out.push("vegetation");
  if (s.slope.enabled) out.push("slope");
  if (s.contours.enabled) out.push("contours");
  if (s.features.enabled) out.push("features");
  return out;
}

export interface ExportSelection {
  format: ExportFormat;
  bundling: ExportBundling;
  layers: TopoLayerKey[];
}

/**
 * Prune an export selection to a legal state for its format and a set of
 * available layers. Pure — the single source of the legality logic the export
 * dialog applied inline (drop layers that are absent or n/a for the format;
 * if nothing remains, default to every available+eligible layer; coerce
 * bundling to a value the format allows). Shared by the dialog, the auto-export
 * tab, and the reaper.
 */
export function reconcileExportSelection(
  value: ExportSelection,
  available: Set<TopoLayerKey>,
): ExportSelection {
  const rule = EXPORT_FORMAT_RULES[value.format];
  const eligibleAndPresent = (name: TopoLayerKey): boolean =>
    available.has(name) && isLayerEligibleForFormat(value.format, name);

  let layers = value.layers.filter(eligibleAndPresent);
  if (layers.length === 0) {
    layers = TOPO_LAYERS.map((m) => m.name).filter(eligibleAndPresent);
  }

  let bundling = value.bundling;
  if (bundling === "composite" && !rule.allowComposite) bundling = "per-layer";
  else if (bundling === "per-layer" && !rule.allowPerLayer) bundling = "composite";

  return { format: value.format, bundling, layers };
}

/**
 * Validate a persisted AutoExportSettings blob (from the client or a stored
 * template). Shape + enum checks, then delegates the format/bundling/layer
 * legality to validateExportRequest. A disabled config still must be
 * structurally valid so it round-trips through persistence unchanged.
 */
export function validateAutoExportSettings(input: unknown): ValidationResult<AutoExportSettings> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["autoExport must be an object"] };
  }
  const v = input as Record<string, unknown>;
  const errors: string[] = [];

  if (typeof v.enabled !== "boolean") errors.push("autoExport.enabled must be boolean");
  if (!EXPORT_FORMAT_RULES[v.format as ExportFormat]) {
    errors.push(`autoExport.format must be one of ${EXPORT_FORMATS.join(", ")}`);
  }
  if (v.bundling !== "composite" && v.bundling !== "per-layer") {
    errors.push("autoExport.bundling must be composite or per-layer");
  }
  if (
    !Array.isArray(v.layers) ||
    v.layers.some((l) => !TOPO_LAYERS.some((m) => m.name === l))
  ) {
    errors.push("autoExport.layers must be an array of known layer names");
  }

  // The layer/format/bundling combination itself must be legal, mirroring the
  // manual export gate. Skipped when shape errors already exist (validate would
  // throw on bad enums).
  if (errors.length === 0) {
    const reqResult = validateExportRequest({
      format: v.format as ExportFormat,
      bundling: v.bundling as ExportBundling,
      layers: v.layers as TopoLayerKey[],
    });
    if (!reqResult.ok) errors.push(reqResult.error);
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      enabled: v.enabled as boolean,
      format: v.format as ExportFormat,
      bundling: v.bundling as ExportBundling,
      layers: v.layers as TopoLayerKey[],
    },
  };
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
  // Adaptive processing-time estimate (seconds) computed at create. Null on
  // rows created before the estimator existed or when the source tile count
  // was unknown — display falls back to a static "Exporting…" label.
  estimatedSeconds: number | null;
  resultBytes: number | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  downloadUrl: string | null;   // presigned, set only when status=completed
  downloadExpiresAt: string | null;
}
