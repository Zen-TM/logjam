import { PDFDocument, PDFName, PDFString, rgb } from "@cantoo/pdf-lib";

export type GeoPdfPageInput = {
  pageWidthPt: number;
  pageHeightPt: number;
  paddingPt: number; // map box inset on all sides
  mapWidthPx: number;
  mapHeightPx: number;
  strips: {
    jpeg: Uint8Array;
    y: number;
    height: number;
    renderHeight: number;
  }[];
  extent: { north: number; south: number; east: number; west: number };
  title?: string; // Info Title; default "Logjam GeoPDF Export"
};

const WGS84_WKT =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",' +
  'SPHEROID["WGS_1984",6378137,298.257223563]],' +
  'PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]]';

function checkStrips(input: GeoPdfPageInput): void {
  const { strips, mapHeightPx } = input;
  if (strips.length === 0) throw new Error("GeoPDF has no strips");
  let next = 0;
  for (const s of strips) {
    if (s.y !== next || s.height <= 0 || s.renderHeight < s.height) {
      throw new Error("GeoPDF strips are not contiguous");
    }
    next = s.y + s.height;
  }
  if (next !== mapHeightPx)
    throw new Error("GeoPDF strips do not cover the map");
}

// Runs in a Web Worker: pdf-lib touches no DOM. Unlike the server writer, a
// failure building the georeferencing throws: a GeoPDF without it is a wrong
// product, and Logjam GPS imports it.
export async function buildGeoPdf(input: GeoPdfPageInput): Promise<Uint8Array> {
  checkStrips(input);
  const { pageWidthPt: w, pageHeightPt: h, paddingPt: pad } = input;
  const mapW = w - 2 * pad;
  const mapH = h - 2 * pad;
  const sx = mapW / input.mapWidthPx;
  const sy = mapH / input.mapHeightPx;

  const doc = await PDFDocument.create();
  doc.setTitle(input.title ?? "Logjam GeoPDF Export");
  doc.setCreator("Logjam");
  doc.setProducer("Logjam GeoPDF Generator");
  const page = doc.addPage([w, h]);
  page.drawRectangle({ x: 0, y: 0, width: w, height: h, color: rgb(1, 1, 1) });

  // Placed from each strip's y (never summed heights); a later strip covers the
  // previous one's overlap rows, so no hairline shows between strips.
  for (const s of input.strips) {
    const img = await doc.embedJpg(s.jpeg);
    page.drawImage(img, {
      x: pad,
      y: pad + mapH - (s.y + s.renderHeight) * sy,
      width: input.mapWidthPx * sx,
      height: s.renderHeight * sy,
    });
  }

  const { north, south, east, west } = input.extent;
  const ctx = doc.context;
  // WKT must be a PDF literal string: a name makes GDAL drop the CRS.
  const gcs = ctx.register(
    ctx.obj({
      Type: "GEOGCS",
      WKT: PDFString.of(WGS84_WKT),
      EPSG: 4326,
    }),
  );
  const measure = ctx.register(
    ctx.obj({
      Type: "Measure",
      Subtype: "GEO",
      // lat,lon pairs: BL, BR, TR, TL
      GPTS: [south, west, south, east, north, east, north, west],
      // Unit square of the viewport BBox, same corner order as GPTS.
      LPTS: [0, 0, 1, 0, 1, 1, 0, 1],
      GCS: gcs,
    }),
  );
  const viewport = ctx.register(
    ctx.obj({
      Type: "Viewport",
      BBox: [pad, pad, w - pad, h - pad],
      Measure: measure,
    }),
  );
  page.node.set(PDFName.of("VP"), ctx.obj([viewport]));

  return doc.save({ useObjectStreams: false });
}
