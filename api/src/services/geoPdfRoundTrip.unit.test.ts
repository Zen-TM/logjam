import { describe, it, expect } from "vitest";
import { createCanvas } from "canvas";
import type { GeoPdfConfig } from "@logjam/shared";
// Deliberate subpath import: geoPdfImport is kept OUT of the shared barrel so
// pdf-lib never rides into the web frontend bundle.
import {
  parseGeoPdfGeoref,
  chooseMainViewport,
} from "@logjam/shared/dist/geoPdfImport/parseGeoref.js";
import { buildGeoTransform } from "@logjam/shared/dist/geoPdfImport/transform.js";
import { buildPdf } from "./generateGeoPdf";

// THE drift guard (Stage 6 §7.2): any future change to the generator's georef
// block must remain readable by the mobile GeoPDF import parser. The
// byte-level test (generateGeoPdf.unit.test.ts) pins the serialized shape;
// this one proves the full semantic round trip — writer → parser → transform
// → the original extent.

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

describe("GeoPDF writer → parser round trip", () => {
  it("reproduces the export extent through parse + transform", async () => {
    const canvas = createCanvas(20, 14);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#cccccc";
    ctx.fillRect(0, 0, 20, 14);
    const pdf = await buildPdf(canvas, 421, 298, 365, 242, 28, config());

    const parsed = await parseGeoPdfGeoref(new Uint8Array(pdf));
    expect(parsed.producer).toBe("Logjam GeoPDF Generator");
    expect(parsed.pages).toHaveLength(1);
    const page = parsed.pages[0];
    const viewport = page.viewports[chooseMainViewport(page)];
    // A current-generator export must NOT need any legacy quirk.
    expect(viewport.quirks).toEqual([]);

    const transform = buildGeoTransform(viewport);
    expect(transform.kind).toBe("affine");
    expect(transform.planeIsWebMercator).toBe(true);
    // The page raster is an exact affine image of EPSG:3857, so corners AND
    // the fit must reproduce the extent to numerical precision.
    expect(transform.maxResidualFractionOfWidth).toBeLessThan(1e-9);
    expect(transform.wgs84Bounds.north).toBeCloseTo(EXTENT.north, 9);
    expect(transform.wgs84Bounds.south).toBeCloseTo(EXTENT.south, 9);
    expect(transform.wgs84Bounds.east).toBeCloseTo(EXTENT.east, 9);
    expect(transform.wgs84Bounds.west).toBeCloseTo(EXTENT.west, 9);

    const corner = transform.pageToLonLat({ x: 28, y: 270 });
    expect(corner.lon).toBeCloseTo(EXTENT.west, 9);
    expect(corner.lat).toBeCloseTo(EXTENT.north, 9);
  });
});
