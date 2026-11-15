// An export of an area: the statewide terrain over a box, as raw data for a
// GIS (GeoTIFF, GeoPackage) or a styled map for an offline app (MBTiles), made
// by the export worker (topo/area_export.py, which mirrors these declarations:
// topo/tests/test_area_export.py).
import { boxCentre, gridZoneOf, type GridId } from "./grids.js";
import { nswContourStyle } from "./contourRules.js";
import {
  layerIn,
  regionAt,
  REGIONS,
  regionsTouching,
  regionTouchesBox,
  type Region,
} from "./regions.js";
import { normalizeUserUiPreferences } from "./themeSchemes.js";
import { say } from "./userSentence.js";

/** What an area export can carry, in the order a file lists them. */
export const AREA_EXPORT_LAYERS = [
  "heights",
  "slope",
  "hillshade",
  "contours",
] as const;
export type AreaExportLayer = (typeof AREA_EXPORT_LAYERS)[number];

export const AREA_EXPORT_FORMATS = ["geotiff", "gpkg", "mbtiles"] as const;
export type AreaExportFormat = (typeof AREA_EXPORT_FORMATS)[number];

/**
 * A GeoTIFF is rasters only: contours go in a GeoPackage. An MBTiles is a
 * picture of the map, so it has no heights to draw.
 */
export const AREA_EXPORT_LAYERS_BY_FORMAT: Readonly<
  Record<AreaExportFormat, readonly AreaExportLayer[]>
> = {
  geotiff: ["heights", "slope", "hillshade"],
  gpkg: AREA_EXPORT_LAYERS,
  mbtiles: ["slope", "hillshade", "contours"],
};

export type AreaBbox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/**
 * The region an export of this box reads its archives from: the region with
 * heights holding the box's centre, else the first region with heights
 * touching the box (the regions `areaInTerrainRegion` admits a box by), so a
 * box over the edge of NSW is exported from NSW however its centre falls.
 * Null when none touches it. `WORLD` has no border and is never the answer.
 * topo/regions.py `export_region` is the same choice, for the worker that
 * reads the archives: `__fixtures__/export-region.json` holds the two equal
 * (this file's test and topo/tests/test_regions.py read it).
 */
export function areaExportRegion(
  bbox: AreaBbox,
  regions: readonly Region[] = REGIONS,
): Region | null {
  const withHeights = regions.filter((each) => layerIn(each, "heights"));
  const { lon, lat } = boxCentre(bbox);
  return (
    regionAt(lon, lat, withHeights) ??
    regionsTouching(bbox, withHeights)[0] ??
    null
  );
}

/** The grid an export of this box is warped to: its region's, UTM where no region with heights touches the box. */
export function areaExportGrid(
  bbox: AreaBbox,
  regions: readonly Region[] = REGIONS,
): GridId {
  return areaExportRegion(bbox, regions)?.grid ?? "utm";
}

/**
 * The EPSG code of the grid the worker warps an export of this box to
 * (`areaExportGrid`), in the zone at the box's centre. The API stores the
 * code on the job beside the box, so the grid the worker uses is the one the
 * dialog names. Guard: `areaExport.test.ts`.
 */
export function areaExportEpsg(
  bbox: AreaBbox,
  regions: readonly Region[] = REGIONS,
): number {
  const { lon, lat } = boxCentre(bbox);
  return gridZoneOf(areaExportGrid(bbox, regions), lon, lat).epsg;
}

/**
 * The longest side a box may have. On the export task's size (4 vCPU, 8 GiB,
 * 20 GiB disk), a 100 km GeoPackage of all four layers took 10 min and made a
 * 2.8 GB file, with 4.3 GB of disk and 1.6 GB of memory at peak. 150 km fits
 * too (23 min, 9.6 GB of disk), but its 6.4 GB file is past the default 5 GiB
 * storage allowance on its own.
 */
export const AREA_EXPORT_MAX_SIDE_KM = 100;

// The limit is written out: a `say` hole takes a number, not a formatted
// string, and the API sends this sentence as it is, in km. The test "says the
// limit it enforces" (`areaExport.test.ts`) holds the 100 to the constant.
export const AREA_EXPORT_TOO_LARGE = say`A map can be up to 100 km on a side. Choose a smaller area, or split it into smaller maps.`;

/**
 * Names no region: a sentence that lists them goes stale when one is added.
 * Guard: `areaExport.test.ts` ("names no region in its refusal"); the
 * worker's copy is held to this one by `test_area_export.py`.
 */
export const AREA_EXPORT_OUTSIDE_TERRAIN = say`Terrain isn't available for that area. Choose an area where it is.`;

/** What the worker says when an export fails for no reason the owner can act
 *  on. Logjam Web offers Report a bug beside exactly this sentence; the
 *  worker's copy is held to it by `test_export_worker_helpers.py`. */
export const AREA_EXPORT_FAILED = say`This map couldn't be made. Start it again.`;

const KM_PER_DEGREE_LAT = 110.57;
const KM_PER_DEGREE_LON_AT_EQUATOR = 111.32;

/** A box's ground size, across its middle latitude and down its side. */
export function areaSizeKm(bbox: AreaBbox): {
  widthKm: number;
  heightKm: number;
} {
  const midLat = ((bbox.north + bbox.south) / 2) * (Math.PI / 180);
  return {
    widthKm:
      (bbox.east - bbox.west) * KM_PER_DEGREE_LON_AT_EQUATOR * Math.cos(midLat),
    heightKm: (bbox.north - bbox.south) * KM_PER_DEGREE_LAT,
  };
}

export function areaExportTooLarge(bbox: AreaBbox): boolean {
  const { widthKm, heightKm } = areaSizeKm(bbox);
  return Math.max(widthKm, heightKm) > AREA_EXPORT_MAX_SIDE_KM;
}

/**
 * Whether the box touches a region with terrain, by its border, a quick check
 * at submit. The border runs a little outside the real one, so a box just
 * over it passes, and the worker, finding no tiles, fails it with the same
 * sentence (topo/area_export.py `AreaOutsideTerrain`).
 */
export function areaInTerrainRegion(
  bbox: AreaBbox,
  regions: readonly Region[] = REGIONS,
): boolean {
  return regions.some(
    (region) =>
      layerIn(region, "heights") !== null && regionTouchesBox(region, bbox),
  );
}

/**
 * What is wrong with a request only a broken client could send, or null:
 * the box is not a box on Earth, or a layer does not fit the format.
 */
export function areaExportRequestError(request: {
  bbox: AreaBbox;
  layers: readonly string[];
  format: string;
}): string | null {
  const { west, south, east, north } = request.bbox;
  if (![west, south, east, north].every(Number.isFinite))
    return "bbox must be four numbers";
  if (south < -90 || north > 90 || west < -180 || east > 180)
    return "bbox is off the Earth";
  if (north <= south || east <= west) return "bbox is empty";
  const allowed = AREA_EXPORT_LAYERS_BY_FORMAT[
    request.format as AreaExportFormat
  ] as readonly string[] | undefined;
  if (!allowed) return `unknown format ${request.format}`;
  if (request.layers.length === 0) return "no layers";
  if (new Set(request.layers).size !== request.layers.length)
    return "a layer is listed twice";
  const misfit = request.layers.find((layer) => !allowed.includes(layer));
  return misfit ? `${request.format} can't hold ${misfit}` : null;
}

/**
 * What an export of an area is drawn with, saved on its row. Raw data (a
 * GeoTIFF, a GeoPackage) has no style. An MBTiles draws the statewide
 * contours in the look the map draws them in, and slope in the account's
 * bands as they are now. The worker reads `slopeBands` beside the contour
 * style (topo/tests/test_area_export.py `SyncWithShared`).
 */
export function areaExportStyleSnapshot(
  format: AreaExportFormat,
  uiPreferences: unknown,
): Record<string, unknown> {
  if (format !== "mbtiles") return {};
  return {
    // The file has no imagery under it.
    ...nswContourStyle("protomaps"),
    slopeBands: normalizeUserUiPreferences(uiPreferences).slopeBands,
  };
}
