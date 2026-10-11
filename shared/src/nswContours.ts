// The statewide contour lines, and when a map draws them.
//
// One archive of 10 m contours cut from the NSW 5 m DEM by
// `topo/build_nsw_dem.py contours`, in the schema a topo area's own contour
// layer has, so both clients style it with the code they already have.
import { NSW_5M } from "./demSources.js";
import {
  VECTOR_STYLE_DEFAULTS,
  type VectorStyleSettings,
} from "./topoSettings.js";

export const NSW_CONTOURS = {
  /** A saved clip is filed under this, beside the basemap it is drawn with. */
  id: "nsw-contours",
  /** A PMTiles archive under the CDN's `/master`, beside the vector basemap. */
  archivePath: "master/contours/nsw-10m.pmtiles",
  /** `CONTOUR_ZOOMS` in the build script; deeper zooms overzoom the last. */
  minzoom: 11,
  maxzoom: 14,
  coverage: NSW_5M.coverage,
  // Cut from the DEM, so they carry its credit.
  credit: NSW_5M.credit.replace(/^Elevation/, "Contours"),
  creditHtml: NSW_5M.creditHtml.replace(/^Elevation/, "Contours"),
} as const;

/**
 * Whether the statewide contours are drawn over a basemap: always with the
 * vector basemap, which has none of its own, and over imagery when the user
 * asks. The topographic sheets already print theirs.
 */
export function drawsNswContours(
  basemapId: string,
  overImagery: boolean,
): boolean {
  return (
    basemapId === "protomaps" || (overImagery && basemapId === "six-imagery")
  );
}

/** Imagery is dark, and the brown a paper map prints its contours in is lost on it. */
const OVER_IMAGERY = { majorColour: "#ffffffe6", minorColour: "#ffffff8c" };

/**
 * The style the statewide contours are drawn in: a fixed look, the brown of a
 * paper map, with light lines over imagery. Deliberately NOT the user's topo
 * style: that belongs to the LiDAR contours of a topo area, a different thing,
 * and restyling one should not restyle the other.
 */
export function nswContourStyle(basemapId: string): VectorStyleSettings {
  return basemapId === "six-imagery"
    ? {
        ...VECTOR_STYLE_DEFAULTS,
        contours: { ...VECTOR_STYLE_DEFAULTS.contours, ...OVER_IMAGERY },
      }
    : VECTOR_STYLE_DEFAULTS;
}

/**
 * The halo behind a contour label, which is drawn in the major line's colour
 * (`#RRGGBBAA`): dark behind a light label, light behind a dark one.
 */
export function contourLabelHalo(majorColour: string): string {
  const [r, g, b] = [1, 3, 5].map((i) =>
    parseInt(majorColour.slice(i, i + 2), 16),
  );
  const light = 0.299 * r! + 0.587 * g! + 0.114 * b! > 150;
  return light ? "rgba(0, 0, 0, 0.7)" : "rgba(255, 255, 255, 0.8)";
}
