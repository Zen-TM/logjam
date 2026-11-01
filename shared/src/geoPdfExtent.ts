import proj4 from "proj4";

// ── Types ────────────────────────────────────────────────────────────────────

export type CoordMode = "latlon" | "enNorthing";
export type PaperSize = "A2" | "A3" | "A4" | "A5" | "custom";
export type Orientation = "portrait" | "landscape";
export interface ExtentState {
  paperSize: PaperSize;
  orientation: Orientation;
  customRatio?: { w: number; h: number };
  north: number; // WGS84 latitude (degrees)
  south: number; // WGS84 latitude (degrees)
  east: number; // WGS84 longitude (degrees)
  west: number; // WGS84 longitude (degrees)
  scale: number; // denominator, e.g. 25000 for 1:25000
  coordMode: CoordMode;
}

// ── Constants ────────────────────────────────────────────────────────────────

export const PAPER_SIZES_MM: Record<
  Exclude<PaperSize, "custom">,
  { w: number; h: number }
> = {
  A2: { w: 420, h: 594 },
  A3: { w: 297, h: 420 },
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
};

/** White border applied to all sides of the PDF page (mm). */
export const GEOPDF_PADDING_MM = 10;

/** Drawable map area dimensions in mm (page minus 1cm padding on all sides). */
export function getMapDimensions(state: ExtentState): { w: number; h: number } {
  const paper = getPaperDimensions(state);
  return {
    w: paper.w - 2 * GEOPDF_PADDING_MM,
    h: paper.h - 2 * GEOPDF_PADDING_MM,
  };
}

const DEG_TO_RAD = Math.PI / 180;
const METERS_PER_DEG_LAT = 110540;
const METERS_PER_DEG_LON_EQUATOR = 111320;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Get paper dimensions in mm, accounting for orientation. */
export function getPaperDimensions(state: ExtentState): {
  w: number;
  h: number;
} {
  let dims: { w: number; h: number };
  if (state.paperSize === "custom") {
    dims = state.customRatio ?? { w: 210, h: 297 };
  } else {
    dims = PAPER_SIZES_MM[state.paperSize];
  }
  // Portrait: w < h. Landscape: swap so w > h.
  if (state.orientation === "landscape") {
    return { w: Math.max(dims.w, dims.h), h: Math.min(dims.w, dims.h) };
  }
  return { w: Math.min(dims.w, dims.h), h: Math.max(dims.w, dims.h) };
}

/** Meters per degree of longitude at a given latitude. */
function metersPerDegLon(latDeg: number): number {
  return METERS_PER_DEG_LON_EQUATOR * Math.cos(latDeg * DEG_TO_RAD);
}

/** Geographic extent width in meters. */
export function geoWidthMeters(state: ExtentState): number {
  const midLat = (state.north + state.south) / 2;
  return (state.east - state.west) * metersPerDegLon(midLat);
}

/** Geographic extent height in meters. */
export function geoHeightMeters(state: ExtentState): number {
  return (state.north - state.south) * METERS_PER_DEG_LAT;
}

/**
 * Calculate scale denominator from current extent and paper size.
 *
 * Scale is defined against the drawable MAP AREA (paper minus padding), not the
 * full sheet, because the exported map image fills the map area — so the printed
 * ratio is geoWidth / mapAreaWidth. A stated 1:10000 must therefore mean the
 * extent spans 10000 × mapAreaWidth on the ground.
 */
export function calcScale(state: ExtentState): number {
  const map = getMapDimensions(state);
  const mapWidthM = map.w / 1000;
  return geoWidthMeters(state) / mapWidthM;
}

/** Map-area aspect ratio (width / height) — the extent must match this so the
 * image isn't stretched when drawn into the padded map area. */
function mapAreaAspectRatio(state: ExtentState): number {
  const map = getMapDimensions(state);
  return map.w / map.h;
}

/** Map (geographic) aspect ratio (width / height in meters). */
export function mapAspectRatio(state: ExtentState): number {
  const h = geoHeightMeters(state);
  if (h === 0) return 1;
  return geoWidthMeters(state) / h;
}

/**
 * Given a desired geo width and height in meters, and a centre point,
 * compute the extent bounds. Returns { north, south, east, west }.
 */
export function extentFromCentreAndSize(
  centreLatDeg: number,
  centreLonDeg: number,
  widthM: number,
  heightM: number,
): { north: number; south: number; east: number; west: number } {
  const halfHeightDeg = heightM / 2 / METERS_PER_DEG_LAT;
  const halfWidthDeg = widthM / 2 / metersPerDegLon(centreLatDeg);
  return {
    north: centreLatDeg + halfHeightDeg,
    south: centreLatDeg - halfHeightDeg,
    east: centreLonDeg + halfWidthDeg,
    west: centreLonDeg - halfWidthDeg,
  };
}

/**
 * Compute new extents from scale + paper, grown or shrunk around the centre.
 * This is the core layout function used by multiple apply* functions.
 */
function extentsFromScale(state: ExtentState, scale: number): ExtentState {
  const map = getMapDimensions(state);
  const targetWidthM = scale * (map.w / 1000);
  const targetHeightM = scale * (map.h / 1000);

  const midLat = (state.north + state.south) / 2;
  const targetWidthDeg = targetWidthM / metersPerDegLon(midLat);
  const targetHeightDeg = targetHeightM / METERS_PER_DEG_LAT;

  const currentWidthDeg = state.east - state.west;
  const currentHeightDeg = state.north - state.south;

  const dw = targetWidthDeg - currentWidthDeg;
  const dh = targetHeightDeg - currentHeightDeg;

  return {
    ...state,
    scale,
    north: state.north + dh / 2,
    south: state.south - dh / 2,
    east: state.east + dw / 2,
    west: state.west - dw / 2,
  };
}

/**
 * After changing the N/S span, adjust E/W to restore the paper aspect ratio.
 * Splits the E/W change between both sides.
 */
function fixEWForRatio(state: ExtentState): ExtentState {
  const ratio = mapAreaAspectRatio(state);
  const heightM = geoHeightMeters(state);
  const targetWidthM = heightM * ratio;
  const midLat = (state.north + state.south) / 2;
  const targetWidthDeg = targetWidthM / metersPerDegLon(midLat);
  const currentWidthDeg = state.east - state.west;
  const dw = targetWidthDeg - currentWidthDeg;

  return {
    ...state,
    east: state.east + dw / 2,
    west: state.west - dw / 2,
  };
}

/**
 * After changing the E/W span, adjust N/S to restore the paper aspect ratio.
 * Splits the N/S change between both sides.
 */
function fixNSForRatio(state: ExtentState): ExtentState {
  const ratio = mapAreaAspectRatio(state);
  const widthM = geoWidthMeters(state);
  const targetHeightM = widthM / ratio;
  const targetHeightDeg = targetHeightM / METERS_PER_DEG_LAT;
  const currentHeightDeg = state.north - state.south;
  const dh = targetHeightDeg - currentHeightDeg;

  return {
    ...state,
    north: state.north + dh / 2,
    south: state.south - dh / 2,
  };
}

// ── Apply Functions ──────────────────────────────────────────────────────────

// Typing an edge pans the box: it keeps its size and scale, the opposite edge
// follows, and the other axis refits the paper's ratio.

export function applyNorthChange(
  state: ExtentState,
  newNorth: number,
): ExtentState {
  if (newNorth <= state.south) return state;
  const delta = newNorth - state.north;
  const panned = { ...state, north: newNorth, south: state.south + delta };
  const fixed = fixEWForRatio(panned);
  return { ...fixed, scale: calcScale(fixed) };
}

export function applySouthChange(
  state: ExtentState,
  newSouth: number,
): ExtentState {
  if (newSouth >= state.north) return state;
  const delta = newSouth - state.south;
  const panned = { ...state, south: newSouth, north: state.north + delta };
  const fixed = fixEWForRatio(panned);
  return { ...fixed, scale: calcScale(fixed) };
}

export function applyEastChange(
  state: ExtentState,
  newEast: number,
): ExtentState {
  if (newEast <= state.west) return state;
  const delta = newEast - state.east;
  const panned = { ...state, east: newEast, west: state.west + delta };
  const fixed = fixNSForRatio(panned);
  return { ...fixed, scale: calcScale(fixed) };
}

export function applyWestChange(
  state: ExtentState,
  newWest: number,
): ExtentState {
  if (newWest >= state.east) return state;
  const delta = newWest - state.west;
  const panned = { ...state, west: newWest, east: state.east + delta };
  const fixed = fixNSForRatio(panned);
  return { ...fixed, scale: calcScale(fixed) };
}

export function applyScaleChange(
  state: ExtentState,
  newScale: number,
): ExtentState {
  if (newScale <= 0) return state;
  return extentsFromScale(state, newScale);
}

export function applyPaperChange(
  state: ExtentState,
  newPaperSize: PaperSize,
  customRatio?: { w: number; h: number },
): ExtentState {
  const updated: ExtentState = {
    ...state,
    paperSize: newPaperSize,
    ...(newPaperSize === "custom" && customRatio ? { customRatio } : {}),
  };
  // Recalculate extents at current scale with new aspect ratio
  return extentsFromScale(updated, state.scale);
}

export function applyOrientationChange(
  state: ExtentState,
  newOrientation: Orientation,
): ExtentState {
  if (newOrientation === state.orientation) return state;
  const updated = { ...state, orientation: newOrientation };
  // Recalculate extents at current scale with swapped aspect ratio
  return extentsFromScale(updated, state.scale);
}

export function applyCoordModeChange(
  state: ExtentState,
  newCoordMode: CoordMode,
): ExtentState {
  return { ...state, coordMode: newCoordMode };
}

// ── Coordinate Conversion (GDA2020 / MGA) ───────────────────────────────────

const WGS84 = "EPSG:4326";

function mgaProj(zone: 54 | 55 | 56): string {
  // GDA2020 / MGA zone projection string
  return `+proj=utm +zone=${zone} +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
}

export function detectMgaZone(lon: number): 54 | 55 | 56 {
  if (lon < 144) return 54;
  if (lon < 150) return 55;
  return 56;
}

export function toEastingNorthing(
  lat: number,
  lon: number,
): { easting: number; northing: number; zone: 54 | 55 | 56 } {
  const zone = detectMgaZone(lon);
  const [easting, northing] = proj4(WGS84, mgaProj(zone), [lon, lat]);
  return { easting, northing, zone };
}

export function fromEastingNorthing(
  easting: number,
  northing: number,
  zone: 54 | 55 | 56,
): { lat: number; lon: number } {
  const [lon, lat] = proj4(mgaProj(zone), WGS84, [easting, northing]);
  return { lat, lon };
}

/**
 * Calculate grid north convergence angle in degrees at a given point.
 * Positive means grid north is east of true north.
 */
export function gridConvergence(lat: number, lon: number): number {
  const zone = detectMgaZone(lon);
  const centralMeridian = (zone - 1) * 6 - 177;
  // Simplified convergence: γ ≈ (lon - centralMeridian) * sin(lat)
  return (lon - centralMeridian) * Math.sin(lat * DEG_TO_RAD);
}
