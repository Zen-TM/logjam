import type { PaperSize, Orientation, CoordMode } from "./geoPdfExtent.js";

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
    contourInterval?: number;
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

// Keep in sync with TOPO_LAYERS (api/src/constants/topoLayers.ts).
export const VALID_GEOPDF_OVERLAY_NAMES = new Set<string>([
  "hillshade",
  "vegetation",
  "slope",
  "contours",
  "features",
]);

/**
 * Validates the security-relevant fields of a GeoPdfConfig against the
 * allowlists above. Returns the first error message, or null if valid.
 *
 * Mirrors the inline checks formerly duplicated in routes/geoPdf.ts so both the
 * live-render path and the template-storage path enforce the same boundary.
 */
export function validateGeoPdfConfig(input: unknown): string | null {
  if (!input || typeof input !== "object") {
    return "config must be an object";
  }
  const config = input as Partial<GeoPdfConfig>;

  if (!config.extent || !config.baseLayer || !config.paperSize) {
    return "Missing required fields: extent, baseLayer, paperSize";
  }
  if (!VALID_GEOPDF_PAPER_SIZES.has(config.paperSize)) {
    return `Invalid paper size: ${config.paperSize}`;
  }
  if (!VALID_GEOPDF_BASE_LAYERS.has(config.baseLayer)) {
    return `Invalid base layer: ${config.baseLayer}`;
  }

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
