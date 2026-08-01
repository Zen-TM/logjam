// CRS resolution for GeoPDF viewports (Stage 6 §2.5).
//
// Resolution order, first hit wins:
//   1. EPSG integer → built-in proj-string table below.
//   2. WKT string → proj4's WKT1 parser (GEOGCS + common PROJCS).
//   3. Neither → UNSUPPORTED_CRS carrying the raw WKT/EPSG for the in-app
//      error report (never logged — may contain file-derived strings).
//
// Datum note: GPTS values are geographic coordinates in the datum underlying
// GCS. For GDA94/GDA2020 vs WGS84 the difference is ≤ ~1.8 m — below GPS
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

// UTM south zones. Same proj-string idiom as mgaProj in geoPdfExtent.ts
// (which is deliberately private to that module); MGA94/MGA2020/UTM-WGS84
// all share GRS80-compatible ellipsoids at our accuracy budget.
const utmSouth = (zone: number) =>
  `+proj=utm +zone=${zone} +south +ellps=GRS80 +units=m +no_defs`;

interface EpsgEntry {
  def: string;
  isGeographic: boolean;
  isWebMercator?: boolean;
}

const EPSG_TABLE: Record<number, EpsgEntry> = {
  4326: { def: "+proj=longlat +datum=WGS84 +no_defs", isGeographic: true },
  4283: { def: GEOGRAPHIC, isGeographic: true }, // GDA94 geographic
  7844: { def: GEOGRAPHIC, isGeographic: true }, // GDA2020 geographic
  3857: { def: WEB_MERCATOR, isGeographic: false, isWebMercator: true },
  900913: { def: WEB_MERCATOR, isGeographic: false, isWebMercator: true },
  // MGA94 zones 54–56
  28354: { def: utmSouth(54), isGeographic: false },
  28355: { def: utmSouth(55), isGeographic: false },
  28356: { def: utmSouth(56), isGeographic: false },
  // MGA2020 zones 54–56
  7854: { def: utmSouth(54), isGeographic: false },
  7855: { def: utmSouth(55), isGeographic: false },
  7856: { def: utmSouth(56), isGeographic: false },
  // UTM south, WGS84
  32754: { def: utmSouth(54), isGeographic: false },
  32755: { def: utmSouth(55), isGeographic: false },
  32756: { def: utmSouth(56), isGeographic: false },
};

/** A probe well inside the NSW operating area, for cross-checking two CRS
 * descriptions against each other. */
const PROBE_LON_LAT: [number, number] = [151, -33.5];

/** Metres of disagreement tolerated between an /EPSG code and a /WKT that
 * claim to describe the same CRS. They should agree exactly; this only allows
 * for floating-point noise. */
const CRS_AGREEMENT_TOLERANCE_M = 1;

export function resolveCrs(crs: GeoPdfCrs): ResolvedCrs {
  const epsg = crs.epsg;
  if (epsg !== undefined) {
    const entry = EPSG_TABLE[epsg];
    if (entry) {
      // The EPSG code used to win outright and the WKT was never consulted.
      // A producer that writes the wrong code — a zone-54 code on a zone-56
      // sheet, say — then yields an overlay misplaced by ~500 km, and the
      // residual check cannot catch it: the affine is fitted IN the wrong
      // plane, so it fits perfectly. When both are present they must agree.
      assertCrsDescriptionsAgree(entry.def, crs);
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
      const [x, y] = converter.forward([151, -33.5]);
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
 * disagreement — the EPSG code stands on its own in that case. */
function assertCrsDescriptionsAgree(epsgDef: string, crs: GeoPdfCrs): void {
  if (crs.kind === "EPSG_ONLY") return;
  let viaEpsg: number[];
  let viaWkt: number[];
  try {
    viaEpsg = proj4("EPSG:4326", epsgDef).forward(PROBE_LON_LAT);
    viaWkt = proj4("EPSG:4326", crs.wkt).forward(PROBE_LON_LAT);
  } catch {
    return;
  }
  if (!viaWkt.every(Number.isFinite) || !viaEpsg.every(Number.isFinite)) return;
  const offBy = Math.hypot(viaEpsg[0]! - viaWkt[0]!, viaEpsg[1]! - viaWkt[1]!);
  if (offBy > CRS_AGREEMENT_TOLERANCE_M) {
    throw new GeoPdfParseError(
      "UNSUPPORTED_CRS",
      `EPSG:${crs.epsg} and the embedded WKT disagree by ${Math.round(offBy)} m`,
    );
  }
}
