// The MGA grid on the live map: GDA2020 / MGA lines of the zone at the view's
// centre, as GeoJSON in lon/lat. Both clients draw it from this one function
// (ADR 0020); the printed grid in the GeoPDF follows the same two-digit label
// convention. Guard: mgaGrid.test.ts.
import {
  detectMgaZone,
  fromEastingNorthing,
  toZoneEastingNorthing,
} from "./geoPdfExtent.js";

export interface GridBbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Below this zoom a grid is noise, and the lines are not built. */
export const MGA_GRID_MIN_ZOOM = 9;

/** Metres between lines at `zoom`, or null when the grid is hidden. Each step
 *  keeps lines roughly 50 to 300 px apart. */
export function mgaGridStep(zoom: number): 10000 | 1000 | 100 | null {
  if (zoom < MGA_GRID_MIN_ZOOM) return null;
  if (zoom < 13) return 10000;
  return zoom < 16 ? 1000 : 100;
}

type Line = {
  type: "Feature";
  properties: Record<string, never>;
  geometry: { type: "LineString"; coordinates: [number, number][] };
};
type Label = {
  type: "Feature";
  properties: { text: string };
  geometry: { type: "Point"; coordinates: [number, number] };
};
export interface MgaGrid {
  lines: { type: "FeatureCollection"; features: Line[] };
  labels: { type: "FeatureCollection"; features: Label[] };
}

const SEGMENTS = 8;

/** The digits a map margin prints: km modulo 100, or hundreds of metres modulo
 *  1000 at the 100 m step ("84" for 6 284 000, "843" for 6 284 300). */
export function mgaGridLabel(metres: number, step: number): string {
  return step >= 1000
    ? String(Math.round(metres / 1000) % 100).padStart(2, "0")
    : String(Math.round(metres / 100) % 1000).padStart(3, "0");
}

export function mgaGrid(bbox: GridBbox, zoom: number): MgaGrid {
  const out: MgaGrid = {
    lines: { type: "FeatureCollection", features: [] },
    labels: { type: "FeatureCollection", features: [] },
  };
  const step = mgaGridStep(zoom);
  if (step === null) return out;

  // ponytail: one zone per view, the centre's. Across a zone edge the far side
  // keeps the centre zone's grid, which is how the GeoPDF prints it too.
  const zone = detectMgaZone((bbox.west + bbox.east) / 2);
  const corners = [
    [bbox.south, bbox.west],
    [bbox.south, bbox.east],
    [bbox.north, bbox.west],
    [bbox.north, bbox.east],
  ].map(([lat, lon]) => toZoneEastingNorthing(lat, lon, zone));
  const eMin = Math.min(...corners.map((c) => c.easting));
  const eMax = Math.max(...corners.map((c) => c.easting));
  const nMin = Math.min(...corners.map((c) => c.northing));
  const nMax = Math.max(...corners.map((c) => c.northing));
  if (![eMin, eMax, nMin, nMax].every(Number.isFinite)) return out;

  const at = (e: number, n: number): [number, number] => {
    const { lat, lon } = fromEastingNorthing(e, n, zone);
    return [lon, lat];
  };
  const run = (from: number, to: number) =>
    Array.from(
      { length: SEGMENTS + 1 },
      (_, i) => from + ((to - from) * i) / SEGMENTS,
    );
  const label = (metres: number, point: [number, number]) =>
    out.labels.features.push({
      type: "Feature",
      properties: { text: mgaGridLabel(metres, step) },
      geometry: { type: "Point", coordinates: point },
    });
  const line = (coordinates: [number, number][]) =>
    out.lines.features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates },
    });

  // Labels sit a tenth in from the view's edge so they stay on screen.
  const nLabel = nMax - (nMax - nMin) * 0.1;
  const eLabel = eMin + (eMax - eMin) * 0.1;
  for (let e = Math.ceil(eMin / step) * step; e <= eMax; e += step) {
    line(run(nMin, nMax).map((n) => at(e, n)));
    label(e, at(e, nLabel));
  }
  for (let n = Math.ceil(nMin / step) * step; n <= nMax; n += step) {
    line(run(eMin, eMax).map((e) => at(e, n)));
    label(n, at(eLabel, n));
  }
  return out;
}
