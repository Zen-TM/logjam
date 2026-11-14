// The archives a GeoPDF reads its Terrain layers from: those of the region its
// sheet is in. Imports only `@logjam/shared`, so the dialog can ask the same
// question as the renderer without loading the render code.
import {
  layerIn,
  REGIONS,
  regionInWrappedView,
  WORLD,
  type LandArchive,
  type LonLatBox,
  type Region,
  type TerrainArchive,
} from "@logjam/shared";

/** A member is null where the region has no such archive: the layer is not available here. */
export type SheetTerrain = {
  /** The archive a hillshade is shaded from: the region's heights. */
  heights: TerrainArchive | null;
  slope: TerrainArchive | null;
  contours: TerrainArchive | null;
  land: LandArchive | null;
  /**
   * The credit of the heights every derived layer is cut from, which a print
   * carries for each of them; null with no region.
   */
  credit: string | null;
};

/**
 * What the region `regionInWrappedView` picks for the sheet's box has to draw:
 * the one at its centre, whichever world copy the box was picked in.
 * ponytail: a sheet over two regions prints all its contours, hillshade, slope
 * and land from that one, so a sheet straddling a border draws the far side
 * from the wrong archives or none. Upgrade: plan the reads of each region in
 * `regionsTouching(box)` and draw each over its own part of the sheet.
 * Guard: sheetTerrain.test.ts ("takes all its Terrain from the one region at
 * its centre, though another touches the sheet"). ADR 0049 records it as the
 * exception to its rule for a printed box.
 */
export function sheetTerrain(
  extent: LonLatBox,
  regions: readonly Region[] = REGIONS,
  world: Region = WORLD,
): SheetTerrain {
  const region = regionInWrappedView(extent, regions, world);
  return {
    heights: layerIn(region, "hillshade"),
    slope: layerIn(region, "slope"),
    contours: layerIn(region, "contours"),
    land: layerIn(region, "land"),
    credit: layerIn(region, "heights")?.credit ?? null,
  };
}
