// The map grids a place is surveyed in: MGA2020 (Australia), NZTM2000 (New
// Zealand) and UTM (everywhere else). All three are transverse Mercator, so
// one zone type and one zone rule per grid cover them. MGA is UTM south on
// GRS80, identical to WGS84 UTM at our accuracy.
//
// The grid follows the place: a region declares its own (`Region.grid`) and
// outside every region the answer is UTM, so the grid overlay works anywhere.
// Guard: grids.test.ts, which checks the projections against LINZ's and USGS's
// published values, not only a round trip.
import proj4 from "proj4";

import {
  REGIONS,
  regionTouchesBox,
  type LonLatBox,
  type Region,
} from "./regions.js";

export type GridId = "mga2020" | "nztm2000" | "utm";

export type GridZone = {
  grid: GridId;
  /** What a label and a typed reference call it: "MGA 56", "NZTM", "UTM 12". */
  name: string;
  /** The proj4 definition. */
  proj: string;
  /** 7856 for MGA2020 zone 56, 2193, 32612 (UTM north) or 32756 (UTM south). */
  epsg: number;
  /** For grid convergence. */
  centralMeridian: number;
  /** The longitudes it answers for; infinite at the outer edge of MGA and for NZTM. */
  west: number;
  east: number;
};

const WGS84 = "EPSG:4326";

/** NSW's three zones; the outer two run on past the state. */
const MGA_ZONES: readonly GridZone[] = (
  [
    [54, -Infinity, 144],
    [55, 144, 150],
    [56, 150, Infinity],
  ] as const
).map(([zone, west, east]) => ({
  grid: "mga2020",
  name: `MGA ${zone}`,
  proj: `+proj=utm +zone=${zone} +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`,
  epsg: 7800 + zone,
  centralMeridian: (zone - 1) * 6 - 177,
  west,
  east,
}));

const NZTM_ZONE: GridZone = {
  grid: "nztm2000",
  name: "NZTM",
  proj: "+proj=tmerc +lat_0=0 +lon_0=173 +k=0.9996 +x_0=1600000 +y_0=10000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  epsg: 2193,
  centralMeridian: 173,
  west: -Infinity,
  east: Infinity,
};

/**
 * UTM zone `index` (0 starts at 180°W) on `side`'s side of the equator. An
 * index outside 0 to 59 is a longitude past 180°, as MapLibre reports a view
 * panned over the date line; it names the zone it wraps to and keeps its
 * longitudes unwrapped, so a clip against them still works.
 * ponytail: no Norway or Svalbard exceptions, no polar grid; add when a region needs them.
 */
function utmZone(index: number, south: boolean): GridZone {
  const zone = (((index % 60) + 60) % 60) + 1;
  const west = index * 6 - 180;
  return {
    grid: "utm",
    name: `UTM ${zone}`,
    proj: `+proj=utm +zone=${zone}${south ? " +south" : ""} +ellps=WGS84 +units=m +no_defs`,
    epsg: (south ? 32700 : 32600) + zone,
    centralMeridian: west + 3,
    west,
    east: west + 6,
  };
}

/** NSW's MGA zone by its number, for a typed reference. */
export function mgaZone(zone: 54 | 55 | 56): GridZone {
  return MGA_ZONES.find((z) => z.name === `MGA ${zone}`)!;
}

const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** The grid used at a place: the region's there, UTM anywhere else. */
export function gridIdAt(
  lon: number,
  lat: number,
  regions: readonly Region[] = REGIONS,
): GridId {
  const at = wrapLon(lon);
  const point = { west: at, east: at, south: lat, north: lat };
  return regions.find((r) => regionTouchesBox(r, point))?.grid ?? "utm";
}

export function gridZoneAt(
  lon: number,
  lat: number,
  regions: readonly Region[] = REGIONS,
): GridZone {
  const id = gridIdAt(lon, lat, regions);
  if (id === "nztm2000") return NZTM_ZONE;
  if (id === "mga2020")
    return (
      MGA_ZONES.find((z) => lon < z.east) ?? MGA_ZONES[MGA_ZONES.length - 1]!
    );
  return utmZone(Math.floor((lon + 180) / 6), lat < 0);
}

/**
 * The zones of the grid at the box's centre that the box touches, west to
 * east. A box over two grids gets the centre's one. The box is unwrapped: one
 * across the date line has `east` past 180.
 */
export function gridZonesFor(
  box: LonLatBox,
  regions: readonly Region[] = REGIONS,
): GridZone[] {
  const lon = (box.west + box.east) / 2;
  const lat = (box.south + box.north) / 2;
  const id = gridIdAt(lon, lat, regions);
  if (id === "nztm2000") return [NZTM_ZONE];
  if (id === "mga2020")
    return MGA_ZONES.filter(
      (z) => Math.max(box.west, z.west) < Math.min(box.east, z.east),
    );
  const first = Math.floor((box.west + 180) / 6);
  const last = Math.min(
    Math.max(first, Math.ceil((box.east + 180) / 6) - 1),
    first + 59,
  );
  return Array.from({ length: last - first + 1 }, (_, i) =>
    utmZone(first + i, lat < 0),
  );
}

/** Easting and northing in `zone`, which need not be the one `lon` falls in. */
export function toGrid(
  lat: number,
  lon: number,
  zone: GridZone,
): { easting: number; northing: number } {
  const [easting, northing] = proj4(WGS84, zone.proj, [lon, lat]);
  return { easting, northing };
}

/** Easting and northing in the zone the point falls in. */
export function toGridAt(
  lat: number,
  lon: number,
  regions: readonly Region[] = REGIONS,
): { easting: number; northing: number; zone: GridZone } {
  const zone = gridZoneAt(lon, lat, regions);
  return { ...toGrid(lat, lon, zone), zone };
}

export function fromGrid(
  easting: number,
  northing: number,
  zone: GridZone,
): { lat: number; lon: number } {
  const [lon, lat] = proj4(zone.proj, WGS84, [easting, northing]);
  return { lat, lon };
}

/**
 * Grid north's angle from true north at a point, in degrees; positive means
 * grid north is east of true north. The first-order rule, which is good to a
 * few hundredths of a degree inside a zone.
 */
export function gridConvergence(
  lat: number,
  lon: number,
  zone: GridZone,
): number {
  const offset = wrapLon(lon - zone.centralMeridian);
  return offset * Math.sin((lat * Math.PI) / 180);
}
