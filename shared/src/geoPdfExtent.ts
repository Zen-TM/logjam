import proj4 from "proj4";

// ── Types ────────────────────────────────────────────────────────────────────

export type CoordMode = "latlon" | "enNorthing";
export type LockMode = "scale" | "position";
export type PaperSize = "A2" | "A3" | "A4" | "A5" | "custom";
export type Orientation = "portrait" | "landscape";
export type PivotPoint =
  | "tl" | "tc" | "tr"
  | "ml" | "mc" | "mr"
  | "bl" | "bc" | "br";

export interface ExtentState {
  paperSize: PaperSize;
  orientation: Orientation;
  customRatio?: { w: number; h: number };
  north: number;   // WGS84 latitude (degrees)
  south: number;   // WGS84 latitude (degrees)
  east: number;    // WGS84 longitude (degrees)
  west: number;    // WGS84 longitude (degrees)
  scale: number;   // denominator, e.g. 25000 for 1:25000
  coordMode: CoordMode;
  lockMode: LockMode;
  pivot: PivotPoint;
}

// ── Constants ────────────────────────────────────────────────────────────────

export const PAPER_SIZES_MM: Record<Exclude<PaperSize, "custom">, { w: number; h: number }> = {
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
export function getPaperDimensions(state: ExtentState): { w: number; h: number } {
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

/** Calculate scale denominator from current extent and paper size. */
export function calcScale(state: ExtentState): number {
  const paper = getPaperDimensions(state);
  const paperWidthM = paper.w / 1000;
  return geoWidthMeters(state) / paperWidthM;
}

/** Paper aspect ratio (width / height). */
function paperAspectRatio(state: ExtentState): number {
  const paper = getPaperDimensions(state);
  return paper.w / paper.h;
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
  const halfHeightDeg = (heightM / 2) / METERS_PER_DEG_LAT;
  const halfWidthDeg = (widthM / 2) / metersPerDegLon(centreLatDeg);
  return {
    north: centreLatDeg + halfHeightDeg,
    south: centreLatDeg - halfHeightDeg,
    east: centreLonDeg + halfWidthDeg,
    west: centreLonDeg - halfWidthDeg,
  };
}

/**
 * Compute new extents from scale + paper, distributed around the pivot.
 * This is the core layout function used by multiple apply* functions.
 */
function extentsFromScaleAndPivot(state: ExtentState, scale: number): ExtentState {
  const paper = getPaperDimensions(state);
  const targetWidthM = scale * (paper.w / 1000);
  const targetHeightM = scale * (paper.h / 1000);

  const midLat = (state.north + state.south) / 2;
  const targetWidthDeg = targetWidthM / metersPerDegLon(midLat);
  const targetHeightDeg = targetHeightM / METERS_PER_DEG_LAT;

  const currentWidthDeg = state.east - state.west;
  const currentHeightDeg = state.north - state.south;

  const dw = targetWidthDeg - currentWidthDeg;
  const dh = targetHeightDeg - currentHeightDeg;

  // Pivot determines how dw and dh are distributed
  const { fracLeft, fracRight, fracTop, fracBottom } = pivotFractions(state.pivot);

  return {
    ...state,
    scale,
    north: state.north + dh * fracTop,
    south: state.south - dh * fracBottom,
    east: state.east + dw * fracRight,
    west: state.west - dw * fracLeft,
  };
}

/**
 * Fractions of expansion allocated to each direction based on pivot.
 * fracLeft + fracRight = 1, fracTop + fracBottom = 1.
 *
 * "tl" pivot means top-left is fixed:
 *   - top fixed → fracTop = 0, fracBottom = 1
 *   - left fixed → fracLeft = 0, fracRight = 1
 */
function pivotFractions(pivot: PivotPoint): {
  fracLeft: number; fracRight: number;
  fracTop: number; fracBottom: number;
} {
  const col = pivot[1] as "l" | "c" | "r"; // second char
  const row = pivot[0] as "t" | "m" | "b"; // first char

  let fracLeft: number, fracRight: number;
  if (col === "l") { fracLeft = 0; fracRight = 1; }
  else if (col === "r") { fracLeft = 1; fracRight = 0; }
  else { fracLeft = 0.5; fracRight = 0.5; }

  let fracTop: number, fracBottom: number;
  if (row === "t") { fracTop = 0; fracBottom = 1; }
  else if (row === "b") { fracTop = 1; fracBottom = 0; }
  else { fracTop = 0.5; fracBottom = 0.5; }

  return { fracLeft, fracRight, fracTop, fracBottom };
}

/**
 * After changing the N/S span, adjust E/W to restore the paper aspect ratio.
 * Distributes the E/W change according to the pivot.
 */
function fixEWForRatio(state: ExtentState): ExtentState {
  const ratio = paperAspectRatio(state);
  const heightM = geoHeightMeters(state);
  const targetWidthM = heightM * ratio;
  const midLat = (state.north + state.south) / 2;
  const targetWidthDeg = targetWidthM / metersPerDegLon(midLat);
  const currentWidthDeg = state.east - state.west;
  const dw = targetWidthDeg - currentWidthDeg;

  const { fracLeft, fracRight } = pivotFractions(state.pivot);
  return {
    ...state,
    east: state.east + dw * fracRight,
    west: state.west - dw * fracLeft,
  };
}

/**
 * After changing the E/W span, adjust N/S to restore the paper aspect ratio.
 * Distributes the N/S change according to the pivot.
 */
function fixNSForRatio(state: ExtentState): ExtentState {
  const ratio = paperAspectRatio(state);
  const widthM = geoWidthMeters(state);
  const targetHeightM = widthM / ratio;
  const targetHeightDeg = targetHeightM / METERS_PER_DEG_LAT;
  const currentHeightDeg = state.north - state.south;
  const dh = targetHeightDeg - currentHeightDeg;

  const { fracTop, fracBottom } = pivotFractions(state.pivot);
  return {
    ...state,
    north: state.north + dh * fracTop,
    south: state.south - dh * fracBottom,
  };
}

// ── Apply Functions ──────────────────────────────────────────────────────────

export function applyNorthChange(state: ExtentState, newNorth: number): ExtentState {
  if (newNorth <= state.south) return state;

  if (state.lockMode === "scale") {
    // Pan: move south by the same delta to preserve height, then fix E/W for ratio
    const delta = newNorth - state.north;
    const panned = { ...state, north: newNorth, south: state.south + delta };
    const fixed = fixEWForRatio(panned);
    return { ...fixed, scale: calcScale(fixed) };
  } else {
    // Lock position: north changes, scale and E/W adjust
    const changed = { ...state, north: newNorth };
    const fixed = fixEWForRatio(changed);
    return { ...fixed, scale: calcScale(fixed) };
  }
}

export function applySouthChange(state: ExtentState, newSouth: number): ExtentState {
  if (newSouth >= state.north) return state;

  if (state.lockMode === "scale") {
    const delta = newSouth - state.south;
    const panned = { ...state, south: newSouth, north: state.north + delta };
    const fixed = fixEWForRatio(panned);
    return { ...fixed, scale: calcScale(fixed) };
  } else {
    const changed = { ...state, south: newSouth };
    const fixed = fixEWForRatio(changed);
    return { ...fixed, scale: calcScale(fixed) };
  }
}

export function applyEastChange(state: ExtentState, newEast: number): ExtentState {
  if (newEast <= state.west) return state;

  if (state.lockMode === "scale") {
    const delta = newEast - state.east;
    const panned = { ...state, east: newEast, west: state.west + delta };
    const fixed = fixNSForRatio(panned);
    return { ...fixed, scale: calcScale(fixed) };
  } else {
    const changed = { ...state, east: newEast };
    const fixed = fixNSForRatio(changed);
    return { ...fixed, scale: calcScale(fixed) };
  }
}

export function applyWestChange(state: ExtentState, newWest: number): ExtentState {
  if (newWest >= state.east) return state;

  if (state.lockMode === "scale") {
    const delta = newWest - state.west;
    const panned = { ...state, west: newWest, east: state.east + delta };
    const fixed = fixNSForRatio(panned);
    return { ...fixed, scale: calcScale(fixed) };
  } else {
    const changed = { ...state, west: newWest };
    const fixed = fixNSForRatio(changed);
    return { ...fixed, scale: calcScale(fixed) };
  }
}

export function applyScaleChange(state: ExtentState, newScale: number): ExtentState {
  if (newScale <= 0) return state;
  return extentsFromScaleAndPivot(state, newScale);
}

export function applyPaperChange(state: ExtentState, newPaperSize: PaperSize, customRatio?: { w: number; h: number }): ExtentState {
  const updated: ExtentState = {
    ...state,
    paperSize: newPaperSize,
    ...(newPaperSize === "custom" && customRatio ? { customRatio } : {}),
  };
  // Recalculate extents at current scale with new aspect ratio
  return extentsFromScaleAndPivot(updated, state.scale);
}

export function applyOrientationChange(state: ExtentState, newOrientation: Orientation): ExtentState {
  if (newOrientation === state.orientation) return state;
  const updated = { ...state, orientation: newOrientation };
  // Recalculate extents at current scale with swapped aspect ratio
  return extentsFromScaleAndPivot(updated, state.scale);
}

export function applyPivotChange(state: ExtentState, newPivot: PivotPoint): ExtentState {
  return { ...state, pivot: newPivot };
}

export function applyCoordModeChange(state: ExtentState, newCoordMode: CoordMode): ExtentState {
  return { ...state, coordMode: newCoordMode };
}

// ── Coordinate Conversion (GDA2020 / MGA) ───────────────────────────────────

const WGS84 = "EPSG:4326";

function mgaProj(zone: 54 | 55 | 56): string {
  // GDA2020 / MGA zone projection string
  const centralMeridian = (zone - 1) * 6 - 177; // 54→141, 55→147, 56→153
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
