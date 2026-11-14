// The archives a GeoPDF reads its Terrain layers from: those of the region its
// sheet is in. Imports only `@logjam/shared`, so the dialog can ask the same
// question as the renderer without loading the render code.
import {
  layerIn,
  REGIONS,
  regionInView,
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
 * What the region `regionInView` picks for the sheet's box has to draw. A sheet
 * over two regions takes all its Terrain from that one, as a map does.
 */
export function sheetTerrain(
  extent: LonLatBox,
  regions: readonly Region[] = REGIONS,
  world: Region = WORLD,
): SheetTerrain {
  const region = regionInView(extent, regions, world);
  return {
    heights: layerIn(region, "hillshade"),
    slope: layerIn(region, "slope"),
    contours: layerIn(region, "contours"),
    land: layerIn(region, "land"),
    credit: layerIn(region, "heights")?.credit ?? null,
  };
}
