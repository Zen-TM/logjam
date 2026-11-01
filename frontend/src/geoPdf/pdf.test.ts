import { describe, it, expect } from "vitest";
// Deliberate subpath imports: geoPdfImport is kept out of the shared barrel so
// pdf-lib never rides into the frontend bundle; a test is not the bundle.
import {
  parseGeoPdfGeoref,
  chooseMainViewport,
} from "@logjam/shared/dist/geoPdfImport/parseGeoref.js";
import { buildGeoTransform } from "@logjam/shared/dist/geoPdfImport/transform.js";
import {
  PDFArray,
  PDFDocument,
  PDFRawStream,
  decodePDFRawStream,
} from "@cantoo/pdf-lib";
import { buildGeoPdf, type GeoPdfPageInput } from "./pdf";

// A 16x16 baseline JPEG; the writer reads only its header, so every strip
// reuses it whatever its nominal size.
const JPEG = Uint8Array.from(
  atob(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDpKKKKAP/Z",
  ),
  (c) => c.charCodeAt(0),
);

const EXTENT = { north: -33.6, south: -33.7, east: 150.3, west: 150.2 };

function input(over: Partial<GeoPdfPageInput> = {}): GeoPdfPageInput {
  return {
    pageWidthPt: 421,
    pageHeightPt: 298,
    paddingPt: 28,
    mapWidthPx: 365,
    mapHeightPx: 242,
    strips: [{ jpeg: JPEG, y: 0, height: 242, renderHeight: 242 }],
    extent: EXTENT,
    ...over,
  };
}

async function text(i: GeoPdfPageInput): Promise<string> {
  return Buffer.from(await buildGeoPdf(i)).toString("latin1");
}

function numbersIn(pdf: string, key: string): number[] {
  const match = pdf.match(new RegExp(`/${key} \\[([^\\]]*)\\]`));
  if (!match) throw new Error(`no /${key} array in PDF`);
  return match[1].trim().split(/\s+/).map(Number);
}

describe("buildGeoPdf georef block", () => {
  // Mutation: serialize WKT with PDFName.of instead of PDFString.of.
  it("writes WKT as a literal string, never a PDF name", async () => {
    const pdf = await text(input());
    expect(pdf).toContain("/WKT (GEOGCS[");
    expect(pdf).not.toContain("/WKT /GEOGCS");
  });

  it("labels the GCS as GEOGCS with an EPSG fallback", async () => {
    const pdf = await text(input());
    expect(pdf).toContain("/Type /GEOGCS");
    expect(pdf).toContain("/EPSG 4326");
  });

  // Mutation: write LPTS as page fractions.
  it("writes LPTS as the BBox unit square", async () => {
    expect(numbersIn(await text(input()), "LPTS")).toEqual([
      0, 0, 1, 0, 1, 1, 0, 1,
    ]);
  });

  // Mutation: swap lat and lon, or reorder the corners.
  it("writes GPTS corners BL, BR, TR, TL as lat,lon", async () => {
    const { north, south, east, west } = EXTENT;
    expect(numbersIn(await text(input()), "GPTS")).toEqual([
      south,
      west,
      south,
      east,
      north,
      east,
      north,
      west,
    ]);
  });

  // Mutation: use the page size as the BBox.
  it("sets the viewport BBox to the inset map box", async () => {
    expect(numbersIn(await text(input()), "BBox")).toEqual([28, 28, 393, 270]);
  });

  it("sets the Info dictionary", async () => {
    const doc = await PDFDocument.load(await buildGeoPdf(input()), {
      updateMetadata: false,
    });
    expect(doc.getTitle()).toBe("Logjam GeoPDF Export");
    expect(doc.getCreator()).toBe("Logjam");
    expect(doc.getProducer()).toBe("Logjam GeoPDF Generator");
    const named = await PDFDocument.load(
      await buildGeoPdf(input({ title: "Mine" })),
      { updateMetadata: false },
    );
    expect(named.getTitle()).toBe("Mine");
  });
});

describe("buildGeoPdf round trip", () => {
  // Mutation: any change to the writer's georef that the Logjam GPS parser reads differently.
  it("reproduces the extent and map box through the shared parser", async () => {
    const parsed = await parseGeoPdfGeoref(await buildGeoPdf(input()));
    expect(parsed.producer).toBe("Logjam GeoPDF Generator");
    const page = parsed.pages[0];
    const viewport = page.viewports[chooseMainViewport(page)];
    expect(viewport.quirks).toEqual([]);
    const t = buildGeoTransform(viewport);
    expect(t.kind).toBe("affine");
    expect(t.maxResidualFractionOfWidth).toBeLessThan(1e-9);
    expect(t.wgs84Bounds.north).toBeCloseTo(EXTENT.north, 9);
    expect(t.wgs84Bounds.south).toBeCloseTo(EXTENT.south, 9);
    expect(t.wgs84Bounds.east).toBeCloseTo(EXTENT.east, 9);
    expect(t.wgs84Bounds.west).toBeCloseTo(EXTENT.west, 9);
    const corner = t.pageToLonLat({ x: 28, y: 270 });
    expect(corner.lon).toBeCloseTo(EXTENT.west, 9);
    expect(corner.lat).toBeCloseTo(EXTENT.north, 9);
  });
});

describe("buildGeoPdf strips", () => {
  // 242 px tall, three strips; the first two carry 16 overlap rows.
  const three = [
    { jpeg: JPEG, y: 0, height: 96, renderHeight: 112 },
    { jpeg: JPEG, y: 96, height: 96, renderHeight: 112 },
    { jpeg: JPEG, y: 192, height: 50, renderHeight: 50 },
  ];

  async function placements(i: GeoPdfPageInput) {
    const doc = await PDFDocument.load(await buildGeoPdf(i), {
      updateMetadata: false,
    });
    const parts = (doc.getPage(0).node.Contents() as PDFArray).asArray();
    const pdf = parts
      .map((r) =>
        Buffer.from(
          decodePDFRawStream(doc.context.lookup(r) as PDFRawStream).decode(),
        ).toString("latin1"),
      )
      .join("\n");
    // pdf-lib draws an image as: q, translate to (x, y), scale to (w, h), Do, Q.
    return pdf
      .split("Q")
      .filter((blk) => blk.includes(" Do"))
      .map((blk) => {
        const [, x, y] = blk.match(/1 0 0 1 (\S+) (\S+) cm/)!.map(Number);
        const [, w, h] = [...blk.matchAll(/(\S+) 0 0 (\S+) 0 0 cm/g)]
          .map((m) => m.map(Number))
          .find(([, w, h]) => w !== 1 || h !== 1)!;
        return { x, y, w, h };
      });
  }

  // Mutation: position strips by summing heights, flip the y axis, or use
  // height instead of renderHeight.
  it("places each strip by its y on the map box", async () => {
    const p = await placements(input({ strips: three }));
    expect(p).toHaveLength(3);
    for (const [i, s] of three.entries()) {
      expect(p[i].x).toBeCloseTo(28);
      expect(p[i].w).toBeCloseTo(365);
      expect(p[i].h).toBeCloseTo(s.renderHeight);
      expect(p[i].y).toBeCloseTo(28 + 242 - (s.y + s.renderHeight));
    }
  });

  // Mutation: draw the strips in reverse order.
  it("draws in index order so a later strip covers the overlap", async () => {
    const p = await placements(input({ strips: three }));
    const bottoms = p.map((q) => q.y);
    expect(bottoms[0]).toBeGreaterThan(bottoms[1]);
    expect(bottoms[1]).toBeGreaterThan(bottoms[2]);
  });

  // Mutation: drop the matching check in checkStrips.
  it.each([
    ["no strips", []],
    ["first y not 0", [{ jpeg: JPEG, y: 16, height: 226, renderHeight: 226 }]],
    [
      "a gap",
      [
        { jpeg: JPEG, y: 0, height: 96, renderHeight: 96 },
        { jpeg: JPEG, y: 112, height: 130, renderHeight: 130 },
      ],
    ],
    [
      "not ending at the map bottom",
      [{ jpeg: JPEG, y: 0, height: 200, renderHeight: 200 }],
    ],
    [
      "renderHeight below height",
      [{ jpeg: JPEG, y: 0, height: 242, renderHeight: 200 }],
    ],
    [
      "unsorted",
      [
        { jpeg: JPEG, y: 96, height: 146, renderHeight: 146 },
        { jpeg: JPEG, y: 0, height: 96, renderHeight: 96 },
      ],
    ],
  ])("throws for %s", async (_n, strips) => {
    await expect(buildGeoPdf(input({ strips }))).rejects.toThrow();
  });
});
