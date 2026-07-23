import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";

import { buildTestPdf, pdfName, validVp } from "./__fixtures__/buildTestPdf";
import {
  GeoPdfParseError,
  chooseMainViewport,
  parseGeoPdfGeoref,
} from "./parseGeoref";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(__dirname, "__fixtures__", name)));

const expectCode = async (bytes: Uint8Array, code: GeoPdfParseError["code"]) => {
  const err = await parseGeoPdfGeoref(bytes).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(GeoPdfParseError);
  expect((err as GeoPdfParseError).code).toBe(code);
};

describe("parseGeoPdfGeoref — tier 1: current Logjam export", () => {
  it("extracts the single GEO viewport with spec LPTS mapping", async () => {
    const result = await parseGeoPdfGeoref(fixture("logjam-a5.pdf"));
    expect(result.pageCount).toBe(1);
    expect(result.producer).toBe("Logjam GeoPDF Generator");
    expect(result.pages).toHaveLength(1);
    const [page] = result.pages;
    expect(page.pageWidthPt).toBe(421);
    expect(page.pageHeightPt).toBe(298);
    expect(page.viewports).toHaveLength(1);

    const vp = page.viewports[0];
    expect(vp.bboxPt).toEqual({ x0: 28, y0: 28, x1: 393, y1: 270 });
    expect(vp.quirks).toEqual([]);
    expect(vp.crs).toEqual({
      kind: "GEOGCS",
      wkt: expect.stringContaining("GEOGCS["),
      epsg: 4326,
    });
    // GPTS (lat, lon) swapped to lonLat; LPTS unit corners → BBox corners.
    expect(vp.controlPoints).toEqual([
      { pagePt: { x: 28, y: 28 }, lonLat: { lon: 150.2, lat: -33.7 } },
      { pagePt: { x: 393, y: 28 }, lonLat: { lon: 150.3, lat: -33.7 } },
      { pagePt: { x: 393, y: 270 }, lonLat: { lon: 150.3, lat: -33.6 } },
      { pagePt: { x: 28, y: 270 }, lonLat: { lon: 150.2, lat: -33.6 } },
    ]);
    expect(vp.boundsPolygonPt).toBeUndefined();
  });
});

describe("parseGeoPdfGeoref — tier 1b: legacy Logjam export (pre-fix)", () => {
  it("recovers georef via the Q0 + Q1 quirks", async () => {
    const result = await parseGeoPdfGeoref(fixture("logjam-legacy-a5.pdf"));
    const vp = result.pages[0].viewports[0];
    // Q0: WKT was a malformed PDF name — GCS unreadable, assume EPSG:4326.
    expect(vp.quirks).toContain("logjam-legacy-wkt-as-name");
    expect(vp.crs).toEqual({ kind: "EPSG_ONLY", epsg: 4326 });
    // Q1: LPTS were page fractions; control points land on the BBox corners.
    expect(vp.quirks).toContain("logjam-legacy-lpts");
    for (const [i, expected] of [
      { x: 28, y: 28 },
      { x: 393, y: 28 },
      { x: 393, y: 270 },
      { x: 28, y: 270 },
    ].entries()) {
      expect(vp.controlPoints[i].pagePt.x).toBeCloseTo(expected.x, 3);
      expect(vp.controlPoints[i].pagePt.y).toBeCloseTo(expected.y, 3);
    }
    expect(vp.controlPoints.map((cp) => cp.lonLat)).toEqual([
      { lon: 150.2, lat: -33.7 },
      { lon: 150.3, lat: -33.7 },
      { lon: 150.3, lat: -33.6 },
      { lon: 150.2, lat: -33.6 },
    ]);
  });
});

describe("parseGeoPdfGeoref — tier 1d: object-stream re-save", () => {
  it("parses the tier-1 fixture after an ObjStm/xref-stream rewrite", async () => {
    const doc = await PDFDocument.load(fixture("logjam-a5.pdf"), {
      updateMetadata: false,
    });
    const resaved = await doc.save({ useObjectStreams: true });
    const result = await parseGeoPdfGeoref(resaved);
    expect(result.pages[0].viewports[0].controlPoints[0]).toEqual({
      pagePt: { x: 28, y: 28 },
      lonLat: { lon: 150.2, lat: -33.7 },
    });
  });
});

describe("parseGeoPdfGeoref — tier 2: GDAL ISO32000 (MGA zone 56)", () => {
  it("extracts PROJCS WKT, EPSG and the Bounds neatline", async () => {
    const result = await parseGeoPdfGeoref(fixture("gdal-mga56.pdf"));
    const vp = result.pages[0].viewports[0];
    expect(vp.crs).toEqual({
      kind: "PROJCS",
      wkt: expect.stringContaining('PROJCS["GDA_1994_MGA_Zone_56"'),
      epsg: 28356,
    });
    expect(vp.bboxPt).toEqual({ x0: 0, y0: 0, x1: 64, y1: 48 });
    expect(vp.controlPoints).toHaveLength(4);
    // GDAL writes Bounds on the Measure dict (no quirk — that is the ISO spot).
    expect(vp.boundsPolygonPt).toHaveLength(4);
    expect(vp.quirks).toEqual([]);
    // TL control point: LPTS (0,1) → page (0, 48).
    const tl = vp.controlPoints[0];
    expect(tl.pagePt).toEqual({ x: 0, y: 48 });
    expect(tl.lonLat.lat).toBeCloseTo(-33.68054070517501, 10);
    expect(tl.lonLat.lon).toBeCloseTo(150.30328463812572, 10);
  });
});

describe("parseGeoPdfGeoref — synthetic cases (tier 1c)", () => {
  it("defaults LPTS to the BBox unit square when absent", async () => {
    const bytes = buildTestPdf({ vp: [validVp({}, { LPTS: undefined })] });
    const result = await parseGeoPdfGeoref(bytes);
    const vp = result.pages[0].viewports[0];
    expect(vp.quirks).toContain("lpts-defaulted");
    // ISO default pair order: (0,0) (0,1) (1,1) (1,0) — positional with GPTS.
    expect(vp.controlPoints.map((cp) => cp.pagePt)).toEqual([
      { x: 28, y: 28 },
      { x: 28, y: 270 },
      { x: 393, y: 270 },
      { x: 393, y: 28 },
    ]);
  });

  it("accepts VP as a bare dict with the vp-not-array quirk", async () => {
    const result = await parseGeoPdfGeoref(buildTestPdf({ vp: validVp() }));
    expect(result.pages[0].viewports[0].quirks).toContain("vp-not-array");
  });

  it("accepts an EPSG-only GCS", async () => {
    const bytes = buildTestPdf({
      vp: [validVp({}, { GCS: { EPSG: 28356 } })],
    });
    const result = await parseGeoPdfGeoref(bytes);
    expect(result.pages[0].viewports[0].crs).toEqual({
      kind: "EPSG_ONLY",
      epsg: 28356,
    });
  });

  it("accepts a 3-point GPTS", async () => {
    const bytes = buildTestPdf({
      vp: [
        validVp(
          {},
          {
            GPTS: [-33.7, 150.2, -33.7, 150.3, -33.6, 150.3],
            LPTS: [0, 0, 1, 0, 1, 1],
          },
        ),
      ],
    });
    const result = await parseGeoPdfGeoref(bytes);
    expect(result.pages[0].viewports[0].controlPoints).toHaveLength(3);
  });

  it("skips non-GEO measure viewports without error", async () => {
    const bytes = buildTestPdf({
      vp: [
        validVp({}, { Subtype: pdfName("RL") }), // rectilinear measure scale
        validVp(),
      ],
    });
    const result = await parseGeoPdfGeoref(bytes);
    expect(result.pages[0].viewports).toHaveLength(1);
  });

  it("records the projcs-type-geogcs-wkt quirk and trusts the WKT", async () => {
    const bytes = buildTestPdf({
      vp: [
        validVp(
          {},
          {
            GCS: {
              Type: pdfName("PROJCS"),
              WKT: 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]]',
            },
          },
        ),
      ],
    });
    const result = await parseGeoPdfGeoref(bytes);
    const vp = result.pages[0].viewports[0];
    expect(vp.quirks).toContain("projcs-type-geogcs-wkt");
    expect(vp.crs.kind).toBe("GEOGCS");
  });

  it("clamps sub-epsilon GPTS overshoot with a quirk", async () => {
    const bytes = buildTestPdf({
      vp: [
        validVp(
          {},
          { GPTS: [-90.0000000005, 150.2, -33.7, 150.3, -33.6, 150.3, -33.6, 150.2] },
        ),
      ],
    });
    const result = await parseGeoPdfGeoref(bytes);
    const vp = result.pages[0].viewports[0];
    expect(vp.quirks).toContain("gpts-out-of-range");
    expect(vp.controlPoints[0].lonLat.lat).toBe(-90);
  });

  it("chooseMainViewport picks the largest-area viewport", async () => {
    const bytes = buildTestPdf({
      vp: [
        validVp({ BBox: [300, 200, 380, 260] }), // small locator
        validVp(),
      ],
    });
    const result = await parseGeoPdfGeoref(bytes);
    expect(chooseMainViewport(result.pages[0])).toBe(1);
  });
});

describe("parseGeoPdfGeoref — error codes", () => {
  it("NOT_A_PDF on junk bytes", async () => {
    await expectCode(new TextEncoder().encode("not a pdf at all"), "NOT_A_PDF");
  });

  it("NO_GEOREF when no page has a VP", async () => {
    await expectCode(buildTestPdf({}), "NO_GEOREF");
  });

  it("LGIDICT_ONLY when TerraGo georef exists but no ISO VP", async () => {
    await expectCode(buildTestPdf({ lgiDict: true }), "LGIDICT_ONLY");
  });

  it("MALFORMED_GEOREF on GPTS/LPTS length mismatch", async () => {
    await expectCode(
      buildTestPdf({ vp: [validVp({}, { LPTS: [0, 0, 1, 0] })] }),
      "MALFORMED_GEOREF",
    );
  });

  it("MALFORMED_GEOREF on odd-length GPTS", async () => {
    await expectCode(
      buildTestPdf({ vp: [validVp({}, { GPTS: [-33.7, 150.2, -33.7, 150.3, -33.6] })] }),
      "MALFORMED_GEOREF",
    );
  });

  it("MALFORMED_GEOREF on far out-of-range GPTS", async () => {
    await expectCode(
      buildTestPdf({
        vp: [
          validVp(
            {},
            { GPTS: [-91.5, 150.2, -33.7, 150.3, -33.6, 150.3, -33.6, 150.2] },
          ),
        ],
      }),
      "MALFORMED_GEOREF",
    );
  });

  it("MALFORMED_GEOREF on collinear control points", async () => {
    await expectCode(
      buildTestPdf({
        vp: [
          validVp(
            {},
            {
              GPTS: [-33.7, 150.2, -33.65, 150.25, -33.6, 150.3],
              LPTS: [0, 0, 0.5, 0.5, 1, 1],
            },
          ),
        ],
      }),
      "MALFORMED_GEOREF",
    );
  });

  it("MALFORMED_GEOREF on degenerate BBox", async () => {
    await expectCode(
      buildTestPdf({ vp: [validVp({ BBox: [28, 28, 28, 270] })] }),
      "MALFORMED_GEOREF",
    );
  });

  it("MALFORMED_GEOREF when a non-Logjam GCS has neither WKT nor EPSG", async () => {
    await expectCode(
      buildTestPdf({ vp: [validVp({}, { GCS: { Type: pdfName("GEOGCS") } })] }),
      "MALFORMED_GEOREF",
    );
  });
});
