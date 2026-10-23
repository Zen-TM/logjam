// An export of an area: the statewide terrain over a box, as raw data for a
// GIS, made by the export worker (topo/area_export.py, which mirrors the layer
// names: topo/tests/test_area_export.py).
import { NSW_5M } from "./demSources.js";
import { say } from "./userSentence.js";

/** What an area export can carry, in the order a file lists them. */
export const AREA_EXPORT_LAYERS = [
  "heights",
  "slope",
  "hillshade",
  "contours",
] as const;
export type AreaExportLayer = (typeof AREA_EXPORT_LAYERS)[number];

export const AREA_EXPORT_FORMATS = ["geotiff", "gpkg"] as const;
export type AreaExportFormat = (typeof AREA_EXPORT_FORMATS)[number];

/** A GeoTIFF is rasters only: contours go in a GeoPackage. */
export const AREA_EXPORT_LAYERS_BY_FORMAT: Readonly<
  Record<AreaExportFormat, readonly AreaExportLayer[]>
> = {
  geotiff: ["heights", "slope", "hillshade"],
  gpkg: AREA_EXPORT_LAYERS,
};

export type AreaBbox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/**
 * The longest side a box may have. On the export task's size (4 vCPU, 8 GiB,
 * 20 GiB disk), a 100 km GeoPackage of all four layers took 10 min and made a
 * 2.8 GB file, with 4.3 GB of disk and 1.6 GB of memory at peak. 150 km fits
 * too (23 min, 9.6 GB of disk), but its 6.4 GB file is past the default 5 GiB
 * storage allowance on its own.
 */
export const AREA_EXPORT_MAX_SIDE_KM = 100;

export const AREA_EXPORT_TOO_LARGE = say`An export can be up to ${AREA_EXPORT_MAX_SIDE_KM} km on a side. Choose a smaller area, or split it into smaller exports.`;

export const AREA_EXPORT_OUTSIDE_NSW = say`That area is outside NSW, where the statewide terrain is. Choose an area in NSW.`;

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

/** Whether the box touches the statewide terrain at all. */
export function areaInNsw(bbox: AreaBbox): boolean {
  const [west, south, east, north] = NSW_5M.coverage;
  return (
    bbox.east > west &&
    bbox.west < east &&
    bbox.north > south &&
    bbox.south < north
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
