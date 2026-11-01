import {
  VALID_GEOPDF_OVERLAY_NAMES,
  VALID_GEOPDF_PAPER_SIZES,
  type CoordMode,
  type GeoPdfConfig,
  type Orientation,
  type PaperSize,
} from "@logjam/shared";

/** localStorage key the dialog's last settings live under. */
export const GEOPDF_SETTINGS_KEY = "logjam.geoPdf.lastSettings";

/**
 * What the dialog opens on next time: how a map is laid out and drawn, never
 * what it is of. No title, extent or place marker, so nothing stored can name
 * or locate a place (root AGENTS.md, Privacy). Guard: geoPdfSettings.test.ts.
 */
export type GeoPdfSettings = {
  paperSize: PaperSize;
  orientation: Orientation;
  customRatio?: { w: number; h: number };
  scale: number;
  baseLayer: string;
  /** What the user chose in the Overlays and Terrain groups, not what the
   *  form sent: a job in the area turns Terrain on without a choice. */
  overlays: string[];
  /** Terrain was ticked or unticked by hand, so it no longer follows the map. */
  terrainPinned: boolean;
  compass: boolean;
  scaleText: boolean;
  scaleBar: boolean;
  gridLines: CoordMode | null;
};

/** The settings of a config that was just sent, and only those. */
export function settingsOf(
  config: GeoPdfConfig,
  choice: { overlays: Iterable<string>; terrainPinned: boolean },
): GeoPdfSettings {
  return {
    paperSize: config.paperSize,
    orientation: config.orientation,
    ...(config.customRatio ? { customRatio: config.customRatio } : {}),
    // Typing an edge leaves a float (24999.999…) that no preset chip matches.
    scale: Math.round(config.scale),
    baseLayer: config.baseLayer,
    overlays: [...choice.overlays],
    terrainPinned: choice.terrainPinned,
    compass: config.elements.compass,
    scaleText: config.elements.scaleText,
    scaleBar: config.elements.scaleBar,
    gridLines: config.elements.gridLines ?? null,
  };
}

const positive = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * A stored value read back, field by field: each one that no longer validates
 * is left out, so the dialog's default stands in for it.
 */
export function readSettings(
  stored: unknown,
  baseLayers: readonly string[],
): Partial<GeoPdfSettings> {
  if (!stored || typeof stored !== "object") return {};
  const s = stored as Record<string, unknown>;
  const out: Partial<GeoPdfSettings> = {};
  if (
    typeof s.paperSize === "string" &&
    VALID_GEOPDF_PAPER_SIZES.has(s.paperSize)
  )
    out.paperSize = s.paperSize as PaperSize;
  if (s.orientation === "portrait" || s.orientation === "landscape")
    out.orientation = s.orientation;
  const ratio = s.customRatio as { w?: unknown; h?: unknown } | undefined;
  if (ratio && positive(ratio.w) && positive(ratio.h))
    out.customRatio = { w: ratio.w, h: ratio.h };
  if (positive(s.scale)) out.scale = s.scale;
  if (typeof s.baseLayer === "string" && baseLayers.includes(s.baseLayer))
    out.baseLayer = s.baseLayer;
  if (
    Array.isArray(s.overlays) &&
    s.overlays.every((o) => typeof o === "string")
  ) {
    const known = s.overlays.filter((o) => VALID_GEOPDF_OVERLAY_NAMES.has(o));
    // A list of names that have all gone is stale, not a choice of none.
    if (known.length > 0 || s.overlays.length === 0) {
      out.overlays = known;
      // Whether Terrain was pinned only means something with the list it pinned.
      if (typeof s.terrainPinned === "boolean")
        out.terrainPinned = s.terrainPinned;
    }
  }
  for (const key of ["compass", "scaleText", "scaleBar"] as const)
    if (typeof s[key] === "boolean") out[key] = s[key];
  if (
    s.gridLines === null ||
    s.gridLines === "latlon" ||
    s.gridLines === "enNorthing"
  )
    out.gridLines = s.gridLines;
  return out;
}
