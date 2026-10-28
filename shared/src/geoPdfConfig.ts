import type { PaperSize, Orientation, CoordMode } from "./geoPdfExtent.js";
import { TERRAIN_LAYER_KEYS } from "./terrain.js";

export interface PlaceMarker {
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
  placeMarkers?: PlaceMarker[];
}

// ── Allowlists ────────────────────────────────────────────────────────────────
// Single source of truth for what a GeoPdfConfig may contain. Used both to
// validate a live render request (routes/geoPdf.ts).

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

// The Terrain group's layers (the statewide ones, and a sharpened area's own
// of the same name) and the vegetation only a sharpened area draws. Guard:
// geoPdfConfig.test.ts.
export const VALID_GEOPDF_OVERLAY_NAMES = new Set<string>([
  ...TERRAIN_LAYER_KEYS,
  "vegetation",
]);

/**
 * Validate a live GeoPDF render request: the security-relevant fields of a
 * GeoPdfConfig against the allowlists above. Returns the first error message,
 * or null if valid.
 */
export function validateGeoPdfConfig(input: unknown): string | null {
  if (!input || typeof input !== "object") {
    return "config must be an object";
  }
  const config = input as Partial<GeoPdfConfig>;

  const missing: string[] = [];
  if (!config.extent) missing.push("extent");
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

  if (config.placeMarkers !== undefined) {
    if (!Array.isArray(config.placeMarkers)) {
      return "Invalid placeMarkers: must be an array";
    }
    for (const m of config.placeMarkers) {
      if (
        !m ||
        typeof m.lat !== "number" ||
        typeof m.lon !== "number" ||
        typeof m.name !== "string" ||
        (m.color !== "owned" && m.color !== "shared")
      ) {
        return "Invalid place marker entry";
      }
    }
  }

  return null;
}
