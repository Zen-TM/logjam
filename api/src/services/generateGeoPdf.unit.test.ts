import { describe, it, expect } from "vitest";
import { createCanvas } from "canvas";
import type { GeoPdfConfig } from "@logjam/shared";
import { buildPdf } from "./generateGeoPdf";

// Byte-level georef regression guard. buildPdf writes the GeoPDF Measure/GEO block that
// GDAL/QGIS/Avenza read to georeference the raster. This test pins the exact serialized
// shape so a future edit (or a pdfkit upgrade) cannot silently re-break the georef the
// way the WKT-as-name bug did — GDAL: "Dictionary key must be a name object" → CRS
// dropped → the map lands in the ocean. See generateGeoPdf.ts georef block.

const EXTENT = { north: -33.6, south: -33.7, east: 150.3, west: 150.2 };

function config(): GeoPdfConfig {
  return {
    paperSize: "A5",
    orientation: "landscape",
    extent: EXTENT,
    scale: 25000,
    baseLayer: "osm-topo",
    overlays: [],
    elements: { compass: false, scaleText: false, scaleBar: false },
  };
}

async function buildGeorefPdf(): Promise<string> {
  // buildPdf only reads config.extent + config.elements.title, and rasterises the canvas
  // to a JPEG — a tiny solid canvas keeps it fast and network-free.
  const canvas = createCanvas(20, 14);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#cccccc";
  ctx.fillRect(0, 0, 20, 14);
  const buf = await buildPdf(canvas, 421, 298, 365, 242, 28, config());
  return buf.toString("latin1");
}

function numbersIn(pdf: string, key: string): number[] {
  const match = pdf.match(new RegExp(`/${key} \\[([^\\]]*)\\]`));
  if (!match) throw new Error(`no /${key} array in PDF`);
  return match[1].trim().split(/\s+/).map(Number);
}

describe("generateGeoPdf buildPdf georef block", () => {
  it("writes WKT as a literal string, never a PDF name", async () => {
    const pdf = await buildGeorefPdf();
    // The fix: literal string (…) — not the name /GEOGCS that GDAL cannot parse.
    expect(pdf).toContain("/WKT (GEOGCS[");
    expect(pdf).not.toContain("/WKT /GEOGCS");
  });

  it("labels the GCS as GEOGCS and includes an EPSG fallback", async () => {
    const pdf = await buildGeorefPdf();
    expect(pdf).toContain("/Type /GEOGCS");
    expect(pdf).not.toContain("/Type /PROJCS");
    expect(pdf).toContain("/EPSG 4326");
  });

  it("writes LPTS as the BBox unit square, not page fractions", async () => {
    const pdf = await buildGeorefPdf();
    expect(numbersIn(pdf, "LPTS")).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
  });

  it("writes GPTS corners in (lat, lon) order matching the extent", async () => {
    const { north, south, east, west } = EXTENT;
    const gpts = numbersIn(await buildGeorefPdf(), "GPTS");
    // BL, BR, TR, TL
    expect(gpts).toEqual([
      south, west,
      south, east,
      north, east,
      north, west,
    ]);
  });
});
