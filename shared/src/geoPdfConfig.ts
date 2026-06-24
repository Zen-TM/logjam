import type { PaperSize, Orientation, CoordMode } from "./geoPdfExtent.js";
import { TOPO_LAYERS } from "./topoSettings.js";

export interface CanyonMarker {
  lat: number;
  lon: number;
  name: string;
  color: "owned" | "shared";
}

export interface GeoPdfConfig {
  paperSize: PaperSize;
  orientation: Orientation;
  customRatio?: { w: number; h: number };
  extent: { north: number; south: number; east: number; west: number };
  scale: number;
  baseLayer: string;
  overlays: string[];
  elements: {
    title?: string;
    compass: boolean;
    scaleText: boolean;
    scaleBar: boolean;
    gridLines?: CoordMode;
  };
  canyonMarkers?: CanyonMarker[];
}

// ── Allowlists ────────────────────────────────────────────────────────────────
// Single source of truth for what a GeoPdfConfig may contain. Used both to
// validate a live render request (routes/geoPdf.ts) and to validate a stored
// GeoPdfTemplate.config (routes/geoPdfTemplates.ts) so a saved template can
// never become a stored-injection vector for the server-side renderer.

export const VALID_GEOPDF_PAPER_SIZES = new Set<string>([
  "A2",
  "A3",
  "A4",
  "A5",
  "custom",
]);

export const VALID_GEOPDF_BASE_LAYERS = new Set<string>([
  "osm",
  "osm-topo",
  "osm-cycle",
  "six-topo",
  "six-base",
  "six-imagery",
]);

// Derived from the canonical TOPO_LAYERS list (ARCH-010) — cannot drift.
export const VALID_GEOPDF_OVERLAY_NAMES = new Set<string>(
  TOPO_LAYERS.map((l) => l.name),
);

/**
 * Core validator for the security-relevant fields of a GeoPdfConfig against the
 * allowlists above. Returns the first error message, or null if valid.
 *
 * `requireExtent` distinguishes the two callers: a live render request must pin
 * an extent (validateGeoPdfConfig), while a stored GeoPdfTemplate.config
 * intentionally omits it (validateGeoPdfTemplateConfig) — a template captures
 * layout/layer prefs without binding to a map region. An extent, when present,
 * is validated either way so a template can never become a stored-injection
 * vector for the server-side renderer.
 */
function validateGeoPdfConfigCore(
  input: unknown,
  requireExtent: boolean,
): string | null {
  if (!input || typeof input !== "object") {
    return "config must be an object";
  }
  const config = input as Partial<GeoPdfConfig>;

  const missing: string[] = [];
  if (requireExtent && !config.extent) missing.push("extent");
  if (!config.baseLayer) missing.push("baseLayer");
  if (!config.paperSize) missing.push("paperSize");
  if (missing.length > 0) {
    return `Missing required fields: ${missing.join(", ")}`;
  }
  if (!VALID_GEOPDF_PAPER_SIZES.has(config.paperSize!)) {
    return `Invalid paper size: ${config.paperSize}`;
  }
  if (!VALID_GEOPDF_BASE_LAYERS.has(config.baseLayer!)) {
    return `Invalid base layer: ${config.baseLayer}`;
  }

  if (config.extent !== undefined) {
    const { north, south, east, west } = config.extent;
    if (
      typeof north !== "number" ||
      typeof south !== "number" ||
      typeof east !== "number" ||
      typeof west !== "number"
    ) {
      return "Invalid extent: north, south, east, west must be numbers";
    }
    if (north <= south || east <= west) {
      return "Invalid extent: north must be > south and east must be > west";
    }
  }

  if (typeof config.scale !== "number" || config.scale <= 0) {
    return "Invalid scale";
  }

  if (config.overlays !== undefined) {
    if (!Array.isArray(config.overlays)) {
      return "Invalid overlays: must be an array";
    }
    for (const name of config.overlays) {
      if (!VALID_GEOPDF_OVERLAY_NAMES.has(name)) {
        return `Invalid overlay name: ${name}`;
      }
    }
  }

  if (config.canyonMarkers !== undefined) {
    if (!Array.isArray(config.canyonMarkers)) {
      return "Invalid canyonMarkers: must be an array";
    }
    for (const m of config.canyonMarkers) {
      if (
        !m ||
        typeof m.lat !== "number" ||
        typeof m.lon !== "number" ||
        typeof m.name !== "string" ||
        (m.color !== "owned" && m.color !== "shared")
      ) {
        return "Invalid canyon marker entry";
      }
    }
  }

  return null;
}

/**
 * Validate a live GeoPDF render request — `extent` is mandatory.
 */
export function validateGeoPdfConfig(input: unknown): string | null {
  return validateGeoPdfConfigCore(input, true);
}

/**
 * Validate a stored GeoPdfTemplate.config — `extent` is optional (a template
 * captures layout/layers without pinning a region), but every other field is
 * enforced identically to a live render request.
 */
export function validateGeoPdfTemplateConfig(input: unknown): string | null {
  return validateGeoPdfConfigCore(input, false);
}

// Status lifecycle for an async GeoPDF render job. Mirrors ExportStatus on
// TopoExportJob — kept as its own type so the two pipelines can diverge.
export type GeoPdfJobStatus = "queued" | "running" | "completed" | "failed";

// Server-side view of a GeoPdfJob row returned to the client. Mirrors the
// Prisma model with serializable dates and the BigInt cast away.
export interface GeoPdfJobView {
  id: string;
  status: GeoPdfJobStatus;
  // The map title from the job config, if one was set — shown (truncated) in
  // the generated-PDFs list. Null when the job had no title.
  title: string | null;
  resultBytes: number | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  downloadUrl: string | null; // presigned, set only when status=completed
  downloadExpiresAt: string | null;
}
