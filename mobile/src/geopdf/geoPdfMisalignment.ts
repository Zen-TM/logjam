// Whether a GeoPDF on screen may be drawn away from the ground it shows.
//
// An import fits a page-to-ground transform through the file's control points;
// `residualFraction` is how far that fit misses its worst point, as a fraction
// of the map's width. Past `RESIDUAL_WARN_FRACTION` the map says so while that
// GeoPDF is in view, because that is when a position is being read off it.
import { RESIDUAL_WARN_FRACTION } from "@logjam/shared/dist/geoPdfImport/transform.js";

import { bboxOnScreen, type Viewport } from "../map/sourceResolver";
import type { GeoPdfImport } from "./geoPdfImportsDb";

/** Metres in a degree of latitude, and of longitude at the equator. */
const METRES_PER_DEGREE = 111_320;

/**
 * At most how far this GeoPDF may sit from true ground, in metres rounded UP
 * to the next 10 (it is a ceiling, so it never rounds down), or null when its
 * fit is within `RESIDUAL_WARN_FRACTION`.
 */
export function geoPdfMisalignmentM(
  geoPdf: Pick<GeoPdfImport, "bbox" | "residualFraction">,
): number | null {
  const { bbox, residualFraction } = geoPdf;
  if (bbox == null || residualFraction == null) return null;
  if (residualFraction <= RESIDUAL_WARN_FRACTION) return null;
  const [west, south, east, north] = bbox;
  const midLatitude = ((south + north) / 2) * (Math.PI / 180);
  const widthM = (east - west) * METRES_PER_DEGREE * Math.cos(midLatitude);
  return Math.ceil((residualFraction * widthM) / 10) * 10;
}

/** The notice for the worst-fitted GeoPDF on screen, or null for none. */
export function misalignedGeoPdfNotice(
  geoPdfs: readonly Pick<GeoPdfImport, "label" | "bbox" | "residualFraction">[],
  viewport: Viewport | null,
): string | null {
  if (viewport == null) return null;
  let worst: { label: string; metres: number } | null = null;
  for (const geoPdf of geoPdfs) {
    if (!bboxOnScreen(geoPdf.bbox, viewport)) continue;
    const metres = geoPdfMisalignmentM(geoPdf);
    if (metres != null && (worst === null || metres > worst.metres)) {
      worst = { label: geoPdf.label, metres };
    }
  }
  return worst
    ? `${worst.label} may be up to ${worst.metres} m out of position`
    : null;
}
