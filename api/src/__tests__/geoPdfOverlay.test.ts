import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { createCanvas, loadImage, type Canvas } from "canvas";
import {
  extentFromCentreAndSize,
  getMapDimensions,
  type ExtentState,
  type GeoPdfConfig,
} from "@logjam/shared";
import { API_URL } from "./_actors";
import {
  AUTH,
  TILE_GREEN,
  realFetch,
  renderGeoPdf,
  stubTileServer,
} from "./_geoPdfRun";
import { seedId } from "../../prisma/seedIds";
import { tileAt, tileBounds } from "../../prisma/seedArchives";

// Requires the seed's completed topo job for alice (api/prisma/seed.ts, "f" 1)
// and its archives in the topo bucket: the worker reads
// outputs/<job>/hillshade.pmtiles from S3 for real, as in prod. The seeded
// raster is one flat grey tile (value 150), so a painted overlay is a grey
// block in the page image; the base layer is the flat green of _geoPdfRun.ts.
vi.mock("../services/email", () => ({ sendEmail: vi.fn() }));
vi.mock("../services/push", () => ({ sendPushToUser: vi.fn() }));

afterEach(() => {
  globalThis.fetch = realFetch;
});

const PAPER: ExtentState = {
  paperSize: "A5",
  orientation: "landscape",
  north: 0,
  south: 0,
  east: 0,
  west: 0,
  scale: 25000,
  coordMode: "latlon",
  lockMode: "scale",
  pivot: "mc",
};
// Where the seed puts the topo job's tile (seed.ts TOPO_TILE).
const TOPO = tileBounds(
  ...(Object.values(tileAt(12, 150.3179, -33.6563)) as [
    number,
    number,
    number,
  ]),
);
/**
 * The extent Logjam Web computes for a paper and scale, placed so the topo
 * tile's east edge sits 30% of the way across: the left of the page is the
 * tile, the right of it (where the credits are drawn) is base layer only.
 */
function extentFor(paper: Partial<ExtentState>) {
  const state = { ...PAPER, ...paper };
  const map = getMapDimensions(state);
  const size = extentFromCentreAndSize(
    (TOPO[1] + TOPO[3]) / 2,
    0,
    (map.w / 1000) * state.scale,
    (map.h / 1000) * state.scale,
  );
  const width = size.east - size.west;
  return {
    north: size.north,
    south: size.south,
    west: TOPO[2] - 0.3 * width,
    east: TOPO[2] + 0.7 * width,
  };
}
const EXTENT = extentFor({});

const BASE_LAYER = "osm";
const CONFIG: GeoPdfConfig = {
  paperSize: PAPER.paperSize,
  orientation: PAPER.orientation,
  extent: EXTENT,
  scale: PAPER.scale,
  baseLayer: BASE_LAYER,
  overlays: [],
  elements: { compass: false, scaleText: false, scaleBar: false },
};

/** The page's map image: the JPEG pdfkit embeds, found by its filter. */
async function mapImage(pdf: Uint8Array): Promise<Canvas> {
  const bytes = Buffer.from(pdf);
  const filter = bytes.indexOf("/DCTDecode");
  const start = bytes.indexOf("stream", filter) + "stream".length;
  const from = bytes.indexOf(Buffer.from([0xff, 0xd8]), start);
  const to = bytes.indexOf("endstream", from);
  const img = await loadImage(bytes.subarray(from, to));
  const canvas = createCanvas(img.width, img.height);
  canvas.getContext("2d").drawImage(img, 0, 0);
  return canvas;
}

/** Mean colour of a block, centred at a fraction of the image. */
function colourAt(canvas: Canvas, fx: number, fy: number) {
  const { data } = canvas
    .getContext("2d")
    .getImageData(fx * canvas.width - 5, fy * canvas.height - 5, 10, 10);
  const mean = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) mean[c] += data[i + c] / (data.length / 4);
  }
  return mean;
}

/** How many pixels of a region differ between two images. */
function differing(
  a: Canvas,
  b: Canvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  const px = (c: Canvas) =>
    c
      .getContext("2d")
      .getImageData(
        x0 * c.width,
        y0 * c.height,
        (x1 - x0) * c.width,
        (y1 - y0) * c.height,
      ).data;
  const [da, db] = [px(a), px(b)];
  let n = 0;
  for (let i = 0; i < da.length; i += 4) {
    if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) > 24) n++;
  }
  return n;
}

describe("GeoPDF overlay render over a seeded completed topo job (alice)", () => {
  it("paints the job's hillshade from S3 and credits its source", async () => {
    stubTileServer(BASE_LAYER);
    const plain = await mapImage((await renderGeoPdf(CONFIG)).pdf);
    const shaded = await mapImage(
      (await renderGeoPdf({ ...CONFIG, overlays: ["hillshade"] })).pdf,
    );

    // Painted: grey inside the tile's footprint, base layer green outside it.
    const [r, g, b] = colourAt(shaded, 0.1, 0.4);
    expect([r, g, b].map((v) => Math.abs(v - 150)).every((d) => d < 10)).toBe(
      true,
    );
    const outside = colourAt(shaded, 0.5, 0.2);
    expect(
      outside.map((v, i) => Math.abs(v - TILE_GREEN[i])).every((d) => d < 10),
    ).toBe(true);
    // Without the overlay the same spot is the base layer.
    const bare = colourAt(plain, 0.1, 0.4);
    expect(
      bare.map((v, i) => Math.abs(v - TILE_GREEN[i])).every((d) => d < 10),
    ).toBe(true);

    // Credited: off the tile the two pages differ only where the attribution
    // block grows by the elevation credit (bottom right), nowhere above it.
    expect(differing(plain, shaded, 0.45, 0, 1, 0.6)).toBe(0);
    expect(differing(plain, shaded, 0.45, 0.75, 1, 1)).toBeGreaterThan(0);
  }, 150_000);

  it("renders a saved template over a seeded topo job", async () => {
    stubTileServer("six-topo");
    const templates = await request(API_URL)
      .get("/geo-pdf-templates")
      .set(AUTH);
    expect(templates.status).toBe(200);
    const template = templates.body.find(
      (t: { id: string }) => t.id === seedId("f", 10),
    );
    expect(template).toBeDefined();

    // What Logjam Web does: the template's layout plus the extent on the map.
    const { pdf } = await renderGeoPdf({
      ...template.config,
      extent: extentFor(template.config),
    });
    const image = await mapImage(pdf);
    // A4 portrait is taller than wide; hillshade (from the template) is painted.
    expect(image.height).toBeGreaterThan(image.width);
    const [r, g, b] = colourAt(image, 0.1, 0.4);
    expect([r, g, b].map((v) => Math.abs(v - 150)).every((d) => d < 10)).toBe(
      true,
    );
  }, 150_000);
});
