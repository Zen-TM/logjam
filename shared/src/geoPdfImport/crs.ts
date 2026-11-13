// CRS resolution for GeoPDF viewports.
//
// Resolution order, first hit wins:
//   1. EPSG integer → the table and UTM rules below.
//   2. WKT string → proj4's WKT1 parser (GEOGCS + common PROJCS).
//   3. Neither → UNSUPPORTED_CRS carrying the raw WKT/EPSG for the in-app
//      error report (never logged — may contain file-derived strings).
//
// Datum note: GPTS values are geographic coordinates in the datum underlying
// GCS. For GDA94/GDA2020/NZGD2000/NAD83 vs WGS84 the difference is ≤ ~2 m — below GPS
// accuracy. GPTS is treated as WGS84 everywhere; no datum-shift machinery.
import proj4 from "proj4";

import { GeoPdfParseError, type GeoPdfCrs } from "./parseGeoref.js";

export interface ResolvedCrs {
  /** Stable key for diagnostics: "EPSG:nnnn" or "WKT". */
  key: string;
  /** proj4-consumable definition (proj string or raw WKT). */
  def: string;
  isGeographic: boolean;
  isWebMercator: boolean;
}

const GEOGRAPHIC = "+proj=longlat +ellps=GRS80 +no_defs";
const WEB_MERCATOR =
  "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +no_defs";

const utm = (zone: number, south: boolean) =>
  `+proj=utm +zone=${zone}${south ? " +south" : ""} +ellps=GRS80 +units=m +no_defs`;

interface EpsgEntry {
  def: string;
  isGeographic: boolean;
  isWebMercator?: boolean;
  /** UTM zone number, for the zoned families. */
  zone?: number;
}

const EPSG_TABLE: Record<number, EpsgEntry> = {
  4326: { def: "+proj=longlat +datum=WGS84 +no_defs", isGeographic: true },
  4283: { def: GEOGRAPHIC, isGeographic: true }, // GDA94 geographic
  7844: { def: GEOGRAPHIC, isGeographic: true }, // GDA2020 geographic
  4269: { def: GEOGRAPHIC, isGeographic: true }, // NAD83 geographic
  4167: { def: GEOGRAPHIC, isGeographic: true }, // NZGD2000 geographic
  3857: { def: WEB_MERCATOR, isGeographic: false, isWebMercator: true },
  900913: { def: WEB_MERCATOR, isGeographic: false, isWebMercator: true },
  // NZTM2000
  2193: {
    def: "+proj=tmerc +lat_0=0 +lon_0=173 +k=0.9996 +x_0=1600000 +y_0=10000000 +ellps=GRS80 +units=m +no_defs",
    isGeographic: false,
  },
};

// UTM families: EPSG codes `first`..`last` are zones `firstZone`.. in order.
// Datum shifts are ignored (see the header), so every family shares one
// definition per zone.
const UTM_FAMILIES: {
  first: number;
  last: number;
  firstZone: number;
  south: boolean;
}[] = [
  { first: 32601, last: 32660, firstZone: 1, south: false }, // WGS 84 north
  { first: 32701, last: 32760, firstZone: 1, south: true }, // WGS 84 south
  { first: 28348, last: 28358, firstZone: 48, south: true }, // MGA94
  { first: 7846, last: 7859, firstZone: 46, south: true }, // MGA2020
  { first: 26901, last: 26923, firstZone: 1, south: false }, // NAD83 UTM 1N to 23N
];

/** Longitude, in degrees, a sheet's centre may lie from its zone's central
 * meridian. A zone spans 6° (3° each side), but real sheets sit in the next
 * zone over near an edge, and Norway's and Svalbard's widened zones reach 6°
 * from theirs. A sheet labelled with a code further out is mislabelled.
 * Guard: "allows 9 degrees from the central meridian and no more" in
 * crs.test.ts. */
const MAX_ZONE_OFFSET_DEG = 9;

function epsgEntry(epsg: number): EpsgEntry | undefined {
  const fixed = EPSG_TABLE[epsg];
  if (fixed) return fixed;
  if (!Number.isInteger(epsg)) return undefined;
  const family = UTM_FAMILIES.find((f) => epsg >= f.first && epsg <= f.last);
  if (!family) return undefined;
  const zone = family.firstZone + epsg - family.first;
  return { def: utm(zone, family.south), isGeographic: false, zone };
}

/** A longitude difference in degrees, wrapped into [-180, 180). */
export const wrapDegrees = (d: number): number =>
  ((((d + 180) % 360) + 360) % 360) - 180;

/** Refuse a zoned code whose zone is far from the sheet. Only for a sheet
 * with no usable WKT, where nothing else places it and its affine fits
 * perfectly in the wrong plane: an EPSG-only sheet, a WKT that does not
 * parse, or a WKT that parses but is undefined (NaN or a throw) at the
 * probe. A WKT that is defined there is compared by
 * assertCrsDescriptionsAgree instead, which also admits a correctly labelled
 * sheet far from its zone, such as a map of a whole continent. */
function assertZoneNearSheet(
  epsg: number,
  zone: number,
  probe: [number, number],
): void {
  const offset = Math.abs(wrapDegrees(probe[0] - (6 * zone - 183)));
  if (offset > MAX_ZONE_OFFSET_DEG) {
    throw new GeoPdfParseError(
      "UNSUPPORTED_CRS",
      `EPSG:${epsg} (UTM zone ${zone}) is far from the sheet`,
    );
  }
}

/** Metres of disagreement tolerated between an /EPSG code and a /WKT that
 * claim to describe the same CRS. They should agree exactly; this only allows
 * for floating-point noise. */
const CRS_AGREEMENT_TOLERANCE_M = 1;

/** `probe` is a [lon, lat] inside the sheet, where its projection is defined:
 * proj4 returns NaN or throws for some projections at a point far outside it. */
export function resolveCrs(
  crs: GeoPdfCrs,
  probe: [number, number],
): ResolvedCrs {
  const epsg = crs.epsg;
  if (epsg !== undefined) {
    const entry = epsgEntry(epsg);
    if (entry) {
      // If the EPSG code wins outright without consulting the WKT, a producer
      // that writes the wrong code — a zone-54 code on a zone-56 sheet, say —
      // yields an overlay misplaced by ~500 km, and the residual check cannot
      // catch it: the affine is fitted in the wrong plane, so it fits
      // perfectly. When both are present they must agree.
      const compared = assertCrsDescriptionsAgree(entry.def, crs, probe);
      if (!compared && entry.zone !== undefined) {
        assertZoneNearSheet(epsg, entry.zone, probe);
      }
      return {
        key: `EPSG:${epsg}`,
        def: entry.def,
        isGeographic: entry.isGeographic,
        isWebMercator: entry.isWebMercator ?? false,
      };
    }
  }

  if (crs.kind !== "EPSG_ONLY") {
    // proj4js parses WKT1 (GEOGCS and common PROJCS: Transverse Mercator,
    // Lambert CC, Mercator). Validate by converting a probe point — proj4
    // accepts some malformed WKT silently and yields NaN.
    try {
      const converter = proj4("EPSG:4326", crs.wkt);
      const [x, y] = converter.forward(probe);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        return {
          key: "WKT",
          def: crs.wkt,
          isGeographic: crs.kind === "GEOGCS",
          isWebMercator: false,
        };
      }
    } catch {
      // fall through to UNSUPPORTED_CRS
    }
  }

  throw new GeoPdfParseError(
    "UNSUPPORTED_CRS",
    crs.kind === "EPSG_ONLY" ? `EPSG:${crs.epsg}` : crs.wkt.slice(0, 200),
  );
}

/** Project one probe point through both descriptions and refuse the pair if
 * they land in different places. A WKT proj4 can't parse is not evidence of
 * disagreement — the EPSG code stands on its own in that case. Returns
 * whether the two were compared. */
function assertCrsDescriptionsAgree(
  epsgDef: string,
  crs: GeoPdfCrs,
  probe: [number, number],
): boolean {
  if (crs.kind === "EPSG_ONLY") return false;
  let viaEpsg: number[];
  let viaWkt: number[];
  try {
    viaEpsg = proj4("EPSG:4326", epsgDef).forward(probe);
    viaWkt = proj4("EPSG:4326", crs.wkt).forward(probe);
  } catch {
    return false;
  }
  if (!viaWkt.every(Number.isFinite) || !viaEpsg.every(Number.isFinite)) {
    return false;
  }
  const offBy = Math.hypot(viaEpsg[0]! - viaWkt[0]!, viaEpsg[1]! - viaWkt[1]!);
  if (offBy > CRS_AGREEMENT_TOLERANCE_M) {
    throw new GeoPdfParseError(
      "UNSUPPORTED_CRS",
      `EPSG:${crs.epsg} and the embedded WKT disagree by ${Math.round(offBy)} m`,
    );
  }
  return true;
}
