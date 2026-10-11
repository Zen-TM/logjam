// The statewide contour lines, and when a map draws them.
//
// One archive of 10 m contours cut from the NSW 5 m DEM by
// `topo/build_nsw_dem.py contours`, in the schema a topo area's own contour
// layer has, so both clients style it with the code they already have.
import { NSW_5M } from "./demSources.js";

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
