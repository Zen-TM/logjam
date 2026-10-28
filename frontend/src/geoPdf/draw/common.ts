// Constants and helpers shared by the drawing modules. Values are the
// server's (api/src/services/generateGeoPdf.ts), kept so the look is identical.
import { latToMercY } from "@logjam/shared";

export type Ctx = OffscreenCanvasRenderingContext2D;

export const MM_PER_INCH = 25.4;
export const DEG_TO_RAD = Math.PI / 180;
// CSS reference DPI the MapLibre overlay styles are authored against.
export const STYLE_DPI = 96;

// The family `fonts.ts` registers: Source Sans 3 (SIL OFL), two weights in one
// family so the `bold ...` font strings pick SemiBold.
export const MAP_FONT = '"Source Sans 3"';

// Fixed cartographic palette. Theme-independent ink for all overlay text,
// lines and panels, chosen for legibility over busy topo basemaps.
export const INK = "#22271f"; // primary text / bars, warm charcoal
export const INK_MUTED = "rgba(40, 44, 38, 0.78)"; // grid lines, attribution
export const PAPER_FILL = "rgba(250, 247, 240, 0.80)"; // soft-card panel fill
export const HAIRLINE = "rgba(70, 64, 52, 0.45)"; // panel border, ticks
export const ACCENT = "#9C5A2E"; // sparse flourishes (iron-oxide brown)
// Desaturated compass-arm tones (true north red, grid north blue, magnetic green).
export const TN_COLOR = "#a23b34";
export const GN_COLOR = "#3f5d7a";
export const MN_COLOR = "#3f6b46";

export function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm * dpi) / MM_PER_INCH);
}

/** Points (PDF coordinate unit, 72 per inch) */
export function mmToPt(mm: number): number {
  return (mm * 72) / MM_PER_INCH;
}

/**
 * The display zoom MapLibre would render this print scale at on a 96-DPI
 * screen: it drives style visibility (contour gating), unlike `computeZoom`'s
 * tile zoom, which the 300-DPI print target inflates. Unclamped.
 */
export function displayZoomForScale(scale: number, latDeg: number): number {
  const cosLat = Math.cos(Math.abs(latDeg) * DEG_TO_RAD);
  return Math.log2((156543.03 * cosLat * STYLE_DPI) / (scale * 0.0254));
}

/** A lat/lon on the Mercator-Y map image (matches computeTileToMapTransform's Y). */
export function latLonToCanvasPx(
  lat: number,
  lon: number,
  extent: { north: number; south: number; east: number; west: number },
  widthPx: number,
  heightPx: number,
): { x: number; y: number } {
  const x = ((lon - extent.west) / (extent.east - extent.west)) * widthPx;
  const mY_north = latToMercY(extent.north);
  const mY_south = latToMercY(extent.south);
  const mY_pt = latToMercY(lat);
  const y = ((mY_north - mY_pt) / (mY_north - mY_south)) * heightPx;
  return { x, y };
}
