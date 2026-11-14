import {
  boxCentre,
  fromGrid,
  gridZoneAt,
  REGIONS,
  toGrid,
  type GridZone,
  type Region,
} from "@logjam/shared";

type Edges = { north: number; south: number; east: number; west: number };

/**
 * The one grid a sheet is printed and typed in: the zone at its centre, read at
 * every corner, so a sheet across a zone edge or the equator gets one set of
 * numbers and the dialog's E/N fields agree with the lines on the page. The
 * extent follows the map into another world copy, so a longitude read back
 * from the grid is moved into the copy the extent is in (`fromGrid` always
 * answers in [-180, 180], and NZTM's zone is never shifted, so the shift
 * cannot live in `fromGrid`). Guards: elements.test.ts and
 * geoPdfExtentFields.test.ts.
 */
export function sheetGrid(extent: Edges, regions: readonly Region[] = REGIONS) {
  const centre = boxCentre(extent);
  const zone: GridZone = gridZoneAt(centre.lon, centre.lat, regions);
  return {
    zone,
    toGrid: (lat: number, lon: number) => toGrid(lat, lon, zone),
    fromGrid: (easting: number, northing: number) => {
      const point = fromGrid(easting, northing, zone);
      const copies = Math.round((centre.lon - point.lon) / 360);
      return { lat: point.lat, lon: point.lon + 360 * copies };
    },
  };
}
