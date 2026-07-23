// GeoPDF georeferencing parser (Stage 6 Part A).
//
// Walks the ISO 32000-2 §12.9 viewport chain — page /VP → /Measure (Subtype
// /GEO) → /GCS — and returns every georeferenced viewport with its control
// points mapped into PDF page space. Backed by @cantoo/pdf-lib (pure JS; xref
// streams, object streams and Flate predictors handled by its parser layer).
//
// NOT exported from the shared barrel (shared/src/index.ts): pdf-lib must not
// ride into the web frontend bundle. Consumers import the subpath
// (shared/dist/geoPdfImport/…).
//
// Fail-loud policy: every anomaly is either a named quirk (parse proceeds,
// quirk recorded on the viewport) or a typed GeoPdfParseError. No silent
// nulls. Error `detail` may contain file-derived strings — it is shown in-app
// only and must never be logged or sent anywhere (privacy rule).
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
} from "@cantoo/pdf-lib";
import type { PDFContext, PDFObject } from "@cantoo/pdf-lib";

export interface GeoPdfControlPoint {
  /** PDF user space, points, origin bottom-left. */
  pagePt: { x: number; y: number };
  /** Degrees. GPTS pairs are (lat, lon) in the file — swapped here, once. */
  lonLat: { lon: number; lat: number };
}

export type GeoPdfCrs =
  | { kind: "GEOGCS" | "PROJCS"; wkt: string; epsg?: number }
  | { kind: "EPSG_ONLY"; epsg: number };

export interface GeoPdfViewport {
  /** Normalised so x0 < x1, y0 < y1. PDF points. */
  bboxPt: { x0: number; y0: number; x1: number; y1: number };
  controlPoints: GeoPdfControlPoint[];
  /** Optional /Bounds neatline mapped to page points; absent ⇒ clip to BBox. */
  boundsPolygonPt?: { x: number; y: number }[];
  crs: GeoPdfCrs;
  quirks: string[];
}

export interface GeoPdfPageGeoref {
  pageIndex: number;
  pageWidthPt: number;
  pageHeightPt: number;
  /** File order. Only GEO viewports that passed all invariants. */
  viewports: GeoPdfViewport[];
}

export interface GeoPdfParseResult {
  pageCount: number;
  producer?: string;
  /** Only pages that have ≥ 1 GEO viewport. */
  pages: GeoPdfPageGeoref[];
}

export type GeoPdfParseErrorCode =
  | "NOT_A_PDF"
  | "ENCRYPTED"
  | "NO_GEOREF"
  | "LGIDICT_ONLY"
  | "MALFORMED_GEOREF"
  | "UNSUPPORTED_CRS";

export class GeoPdfParseError extends Error {
  code: GeoPdfParseErrorCode;
  detail?: string;

  constructor(code: GeoPdfParseErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "GeoPdfParseError";
    this.code = code;
    this.detail = detail;
  }
}

export const LOGJAM_PRODUCER = "Logjam GeoPDF Generator";

/** GPTS lat/lon out-of-range beyond this is MALFORMED_GEOREF; within it, clamp + quirk. */
const GPTS_CLAMP_EPSILON_DEG = 1e-6;

const name = PDFName.of.bind(PDFName);

function resolve(ctx: PDFContext, obj: PDFObject | undefined): PDFObject | undefined {
  if (obj instanceof PDFRef) return ctx.lookup(obj);
  return obj;
}

function asNumberArray(ctx: PDFContext, obj: PDFObject | undefined): number[] | undefined {
  const resolved = resolve(ctx, obj);
  if (!(resolved instanceof PDFArray)) return undefined;
  const out: number[] = [];
  for (const item of resolved.asArray()) {
    const n = resolve(ctx, item);
    if (!(n instanceof PDFNumber)) return undefined;
    out.push(n.asNumber());
  }
  return out;
}

function asString(ctx: PDFContext, obj: PDFObject | undefined): string | undefined {
  const resolved = resolve(ctx, obj);
  if (resolved instanceof PDFString || resolved instanceof PDFHexString) {
    return resolved.decodeText();
  }
  return undefined;
}

function asDict(ctx: PDFContext, obj: PDFObject | undefined): PDFDict | undefined {
  const resolved = resolve(ctx, obj);
  return resolved instanceof PDFDict ? resolved : undefined;
}

function nameValue(ctx: PDFContext, obj: PDFObject | undefined): string | undefined {
  const resolved = resolve(ctx, obj);
  // PDFName.toString() renders "/GEOGCS" — strip the slash.
  return resolved instanceof PDFName ? resolved.toString().slice(1) : undefined;
}

interface QuirkContext {
  producer?: string;
  pageWidthPt: number;
  pageHeightPt: number;
}

function parseViewport(
  ctx: PDFContext,
  viewportDict: PDFDict,
  quirkCtx: QuirkContext,
  extraQuirks: string[],
): GeoPdfViewport | null {
  const quirks = [...extraQuirks];

  const typeName = nameValue(ctx, viewportDict.get(name("Type")));
  if (typeName !== undefined && typeName !== "Viewport") {
    throw new GeoPdfParseError("MALFORMED_GEOREF", `viewport Type is /${typeName}`);
  }

  const bbox = asNumberArray(ctx, viewportDict.get(name("BBox")));
  if (!bbox || bbox.length !== 4) {
    throw new GeoPdfParseError("MALFORMED_GEOREF", "viewport BBox missing or not 4 numbers");
  }
  const bboxPt = {
    x0: Math.min(bbox[0], bbox[2]),
    y0: Math.min(bbox[1], bbox[3]),
    x1: Math.max(bbox[0], bbox[2]),
    y1: Math.max(bbox[1], bbox[3]),
  };
  if (bboxPt.x1 - bboxPt.x0 <= 0 || bboxPt.y1 - bboxPt.y0 <= 0) {
    throw new GeoPdfParseError("MALFORMED_GEOREF", "viewport BBox is degenerate");
  }

  const measure = asDict(ctx, viewportDict.get(name("Measure")));
  if (!measure) return null; // no Measure: not a geo viewport — skip, not an error
  const subtype = nameValue(ctx, measure.get(name("Subtype")));
  if (subtype !== "GEO") return null; // measurement-scale viewport — skip

  const gpts = asNumberArray(ctx, measure.get(name("GPTS")));
  if (!gpts || gpts.length < 6 || gpts.length % 2 !== 0) {
    throw new GeoPdfParseError("MALFORMED_GEOREF", "GPTS missing, too short, or odd length");
  }

  let lpts = asNumberArray(ctx, measure.get(name("LPTS")));
  if (lpts === undefined) {
    // ISO default: the unit square of the BBox. Correspondence with GPTS is
    // positional, so the default's own corner order needs no reconciliation.
    lpts = [0, 0, 0, 1, 1, 1, 1, 0].slice(0, gpts.length);
    quirks.push("lpts-defaulted");
  }
  if (lpts.length !== gpts.length) {
    throw new GeoPdfParseError("MALFORMED_GEOREF", "LPTS/GPTS length mismatch");
  }

  // Legacy Logjam quirk Q1: LPTS normalised to the PAGE, not the BBox. Detect
  // by matching each pair against (BBox corner ÷ page size); never key off
  // producer alone — post-fix Logjam exports are spec-conformant.
  const isLogjam = quirkCtx.producer === LOGJAM_PRODUCER;
  const unitSquareCorners = lpts.every((v) => v === 0 || v === 1);
  let legacyPageNormalised = false;
  if (isLogjam && !unitSquareCorners) {
    legacyPageNormalised = true;
    for (let i = 0; i < lpts.length; i += 2) {
      const px = lpts[i] * quirkCtx.pageWidthPt;
      const py = lpts[i + 1] * quirkCtx.pageHeightPt;
      const nearBboxCorner =
        (Math.abs(px - bboxPt.x0) < 1e-3 || Math.abs(px - bboxPt.x1) < 1e-3) &&
        (Math.abs(py - bboxPt.y0) < 1e-3 || Math.abs(py - bboxPt.y1) < 1e-3);
      if (!nearBboxCorner) {
        legacyPageNormalised = false;
        break;
      }
    }
    if (legacyPageNormalised) quirks.push("logjam-legacy-lpts");
  }

  const controlPoints: GeoPdfControlPoint[] = [];
  for (let i = 0; i < gpts.length; i += 2) {
    let lat = gpts[i];
    let lon = gpts[i + 1];
    if (
      Math.abs(lat) > 90 + GPTS_CLAMP_EPSILON_DEG ||
      Math.abs(lon) > 180 + GPTS_CLAMP_EPSILON_DEG
    ) {
      throw new GeoPdfParseError("MALFORMED_GEOREF", "GPTS coordinate out of range");
    }
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      lat = Math.max(-90, Math.min(90, lat));
      lon = Math.max(-180, Math.min(180, lon));
      if (!quirks.includes("gpts-out-of-range")) quirks.push("gpts-out-of-range");
    }
    const u = lpts[i];
    const v = lpts[i + 1];
    const pagePt = legacyPageNormalised
      ? { x: u * quirkCtx.pageWidthPt, y: v * quirkCtx.pageHeightPt }
      : {
          x: bboxPt.x0 + u * (bboxPt.x1 - bboxPt.x0),
          y: bboxPt.y0 + v * (bboxPt.y1 - bboxPt.y0),
        };
    controlPoints.push({ pagePt, lonLat: { lon, lat } });
  }

  // Collinear control points cannot anchor an affine fit.
  const [p0, p1] = [controlPoints[0].pagePt, controlPoints[1].pagePt];
  const collinear = controlPoints.every((cp) => {
    const cross =
      (p1.x - p0.x) * (cp.pagePt.y - p0.y) - (p1.y - p0.y) * (cp.pagePt.x - p0.x);
    return Math.abs(cross) < 1e-9;
  });
  if (collinear) {
    throw new GeoPdfParseError("MALFORMED_GEOREF", "control points are collinear");
  }

  // Neatline. ISO 32000 puts /Bounds on the Measure dict; some producers put
  // it on the viewport (quirk-recorded). Same normalised space as LPTS.
  let bounds = asNumberArray(ctx, measure.get(name("Bounds")));
  if (bounds === undefined) {
    bounds = asNumberArray(ctx, viewportDict.get(name("Bounds")));
    if (bounds !== undefined) quirks.push("bounds-on-viewport");
  }
  let boundsPolygonPt: { x: number; y: number }[] | undefined;
  if (bounds !== undefined) {
    if (bounds.length < 6 || bounds.length % 2 !== 0) {
      throw new GeoPdfParseError("MALFORMED_GEOREF", "Bounds is not a polygon");
    }
    boundsPolygonPt = [];
    for (let i = 0; i < bounds.length; i += 2) {
      const u = bounds[i];
      const v = bounds[i + 1];
      boundsPolygonPt.push(
        legacyPageNormalised
          ? { x: u * quirkCtx.pageWidthPt, y: v * quirkCtx.pageHeightPt }
          : {
              x: bboxPt.x0 + u * (bboxPt.x1 - bboxPt.x0),
              y: bboxPt.y0 + v * (bboxPt.y1 - bboxPt.y0),
            },
      );
    }
  }

  // GCS. Any of WKT / EPSG suffices. The legacy Logjam writer emitted WKT as
  // a malformed PDF name (quirk Q0) — pdf-lib recovers the surrounding
  // structure but the GCS resolves to an invalid object, so for the Logjam
  // producer we recover with the known EPSG:4326 (every legacy export is
  // WGS84 geographic).
  const gcs = asDict(ctx, measure.get(name("GCS")));
  let crs: GeoPdfCrs;
  if (gcs) {
    const wkt = asString(ctx, gcs.get(name("WKT")));
    const epsgObj = resolve(ctx, gcs.get(name("EPSG")));
    const epsg = epsgObj instanceof PDFNumber ? epsgObj.asNumber() : undefined;
    const gcsType = nameValue(ctx, gcs.get(name("Type")));
    if (wkt !== undefined) {
      const wktKind = wkt.trimStart().startsWith("PROJCS") ? "PROJCS" : "GEOGCS";
      if (gcsType !== undefined && gcsType !== wktKind) {
        // Quirk Q2: Type says one thing, WKT says another. Trust the WKT.
        quirks.push("projcs-type-geogcs-wkt");
      }
      crs = { kind: wktKind, wkt, epsg };
    } else if (epsg !== undefined) {
      crs = { kind: "EPSG_ONLY", epsg };
    } else if (isLogjam) {
      quirks.push("logjam-legacy-wkt-as-name");
      crs = { kind: "EPSG_ONLY", epsg: 4326 };
    } else {
      throw new GeoPdfParseError("MALFORMED_GEOREF", "GCS has neither WKT nor EPSG");
    }
  } else if (isLogjam) {
    // Q0: pdf-lib could not even keep the GCS dict (WKT-as-name corrupted it).
    quirks.push("logjam-legacy-wkt-as-name");
    crs = { kind: "EPSG_ONLY", epsg: 4326 };
  } else {
    throw new GeoPdfParseError("MALFORMED_GEOREF", "Measure has no GCS dict");
  }

  return { bboxPt, controlPoints, boundsPolygonPt, crs, quirks };
}

export async function parseGeoPdfGeoref(bytes: Uint8Array): Promise<GeoPdfParseResult> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
      ignoreEncryption: true,
    });
  } catch (err) {
    throw new GeoPdfParseError("NOT_A_PDF", err instanceof Error ? err.message : undefined);
  }

  const ctx = doc.context;
  let producer: string | undefined;
  try {
    producer = doc.getProducer();
  } catch {
    producer = undefined; // malformed Info dict — quirk detection just won't fire
  }

  const encrypted = doc.isEncrypted;
  const pages: GeoPdfPageGeoref[] = [];
  let sawLgiDict = false;

  doc.getPages().forEach((page, pageIndex) => {
    // LGIDict (TerraGo) detection only — parsing it is deferred; the UX needs
    // to distinguish "older georef format" from "no georef".
    if (page.node.get(name("LGIDict")) !== undefined) sawLgiDict = true;

    // /VP is not inheritable — read on the page dict only. Per spec it is an
    // array of viewport dicts; accept a bare dict (quirk vp-not-array).
    const vpRaw = resolve(ctx, page.node.get(name("VP")));
    if (vpRaw === undefined) return;
    let viewportDicts: PDFDict[];
    let vpQuirks: string[] = [];
    if (vpRaw instanceof PDFArray) {
      viewportDicts = vpRaw
        .asArray()
        .map((v) => resolve(ctx, v))
        .filter((v): v is PDFDict => v instanceof PDFDict);
    } else if (vpRaw instanceof PDFDict) {
      viewportDicts = [vpRaw];
      vpQuirks = ["vp-not-array"];
    } else {
      throw new GeoPdfParseError("MALFORMED_GEOREF", "VP is neither array nor dict");
    }

    const quirkCtx: QuirkContext = {
      producer,
      pageWidthPt: page.getWidth(),
      pageHeightPt: page.getHeight(),
    };
    const viewports: GeoPdfViewport[] = [];
    for (const viewportDict of viewportDicts) {
      const parsed = parseViewport(ctx, viewportDict, quirkCtx, vpQuirks);
      if (parsed) {
        if (encrypted) parsed.quirks.push("encrypted-structure");
        viewports.push(parsed);
      }
    }
    if (viewports.length > 0) {
      pages.push({
        pageIndex,
        pageWidthPt: page.getWidth(),
        pageHeightPt: page.getHeight(),
        viewports,
      });
    }
  });

  if (pages.length === 0) {
    if (sawLgiDict) throw new GeoPdfParseError("LGIDICT_ONLY");
    if (encrypted) {
      // Structure may simply have been unreadable because of encryption.
      throw new GeoPdfParseError("ENCRYPTED");
    }
    throw new GeoPdfParseError("NO_GEOREF");
  }

  return { pageCount: doc.getPageCount(), producer, pages };
}

/**
 * Import-time viewport choice: the largest-area valid GEO viewport on the
 * page (inset/locator maps are small). Returned index is recorded in the
 * import row for debuggability.
 */
export function chooseMainViewport(page: GeoPdfPageGeoref): number {
  let best = 0;
  let bestArea = -1;
  page.viewports.forEach((vp, i) => {
    const area = (vp.bboxPt.x1 - vp.bboxPt.x0) * (vp.bboxPt.y1 - vp.bboxPt.y0);
    if (area > bestArea) {
      bestArea = area;
      best = i;
    }
  });
  return best;
}
