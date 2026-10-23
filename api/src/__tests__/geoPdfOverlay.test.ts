import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createCanvas, loadImage, type Canvas } from "canvas";
import {
  extentFromCentreAndSize,
  getMapDimensions,
  getPaperDimensions,
  type ExtentState,
  type GeoPdfConfig,
} from "@logjam/shared";
import {
  AUTH,
  TILE_GREEN,
  realFetch,
  renderGeoPdf,
  stubTileServer,
} from "./_geoPdfRun";
// Subpath import: geoPdfImport is kept out of the shared barrel (pdf-lib).
import { parseGeoPdfGeoref } from "@logjam/shared/dist/geoPdfImport/parseGeoref.js";
import { seedId } from "../../prisma/seedIds";
import {
  flatPng,
  singleTilePmtiles,
  tileAt,
  tileBounds,
} from "../../prisma/seedArchives";
import prisma from "../services/prisma";
import { s3 } from "../services/awsClients";
import { latToMercY, computeZoom, TARGET_DPI } from "@logjam/shared";
import { API_URL, ALICE_ID } from "./_actors";

// Requires the seed's saved GeoPDF template (api/prisma/seed.ts, "f" 10) and
// the topo bucket. Each test makes its own completed topo job, with ONE hillshade
// tile in S3 at the zoom the page renders at: the seed's archives hold only z12,
// the zoom Logjam Web's map draws a topo at, and a GeoPDF reads overlays at its
// print zoom (z16 or deeper at 1:25,000). The worker reads the archive from S3
// for real, as in prod. The tile is flat grey (150) on a flat green base layer
// (_geoPdfRun.ts), so a painted overlay is a grey block in the page image.
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
/** The extent Logjam Web computes for a paper and scale around a centre. */
function extentFor(paper: Partial<ExtentState>) {
  const state = { ...PAPER, ...paper };
  const map = getMapDimensions(state);
  return extentFromCentreAndSize(
    -33.7126,
    150.3119,
    (map.w / 1000) * state.scale,
    (map.h / 1000) * state.scale,
  );
}
const EXTENT = extentFor({});

type Extent = typeof EXTENT;

/**
 * A completed topo job of alice's with one hillshade tile under the 25%-across,
 * mid-height point of the page. Returns where that tile's centre falls on the
 * page (fractions) and removes the job and object.
 */
async function topoTileUnder(extent: Extent, scale: number) {
  const centreLat = (extent.north + extent.south) / 2;
  const lon = extent.west + 0.25 * (extent.east - extent.west);
  const z = computeZoom(scale, centreLat, TARGET_DPI, 18);
  const tile = tileAt(z, lon, centreLat);
  const [west, south, east, north] = tileBounds(tile.z, tile.x, tile.y);
  const id = randomUUID();
  const key = `outputs/${id}/hillshade.pmtiles`;
  const archive = singleTilePmtiles({
    ...tile,
    tile: flatPng(150),
    type: "png",
  });
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_TOPO,
      Key: key,
      Body: archive,
    }),
  );
  await prisma.topoJob.create({
    data: {
      id,
      userId: ALICE_ID,
      status: "complete",
      name: "geoPdfOverlay test",
      footprint: {
        type: "Polygon",
        coordinates: [
          [
            [west, south],
            [east, south],
            [east, north],
            [west, north],
            [west, south],
          ],
        ],
      },
      s3OutputKeys: [{ name: "hillshade", cogKey: null, pmtilesKey: key }],
    },
  });
  const merc = (lat: number) => latToMercY(lat);
  return {
    fx: ((west + east) / 2 - extent.west) / (extent.east - extent.west),
    fy:
      (merc(extent.north) - merc((south + north) / 2)) /
      (merc(extent.north) - merc(extent.south)),
    remove: async () => {
      await prisma.topoJob.deleteMany({ where: { id } });
      await s3.send(
        new DeleteObjectCommand({
          Bucket: process.env.S3_BUCKET_TOPO,
          Key: key,
        }),
      );
    },
  };
}

const MM_TO_PT = 72 / 25.4;
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

const isGrey = (c: number[]) => c.every((v) => Math.abs(v - 150) < 10);
const isGreen = (c: number[]) =>
  c.every((v, i) => Math.abs(v - TILE_GREEN[i]) < 10);

describe("GeoPDF overlay render over a completed topo job (alice)", () => {
  it("paints the job's hillshade from S3 and credits its source", async () => {
    const tiles = stubTileServer(BASE_LAYER);
    const topo = await topoTileUnder(EXTENT, CONFIG.scale);
    try {
      const plain = await mapImage((await renderGeoPdf(CONFIG)).pdf);
      const shaded = await mapImage(
        (await renderGeoPdf({ ...CONFIG, overlays: ["hillshade"] })).pdf,
      );
      // Only this process's worker answers from the stub; a launched container
      // (ECS_SUBNETS set) would render real tiles and fail the pixels below.
      expect(
        tiles.length,
        "a worker container rendered: unset ECS_SUBNETS",
      ).toBeGreaterThan(0);

      // Painted: grey on the tile, the base layer elsewhere, and the base layer
      // at the same spot when the overlay is not asked for.
      expect(isGrey(colourAt(shaded, topo.fx, topo.fy))).toBe(true);
      expect(isGreen(colourAt(shaded, 0.8, 0.3))).toBe(true);
      expect(isGreen(colourAt(plain, topo.fx, topo.fy))).toBe(true);

      // Credited: the two pages differ only where the attribution block grows
      // by the elevation credit (bottom right), nowhere above it off the tile.
      expect(differing(plain, shaded, 0.5, 0, 1, 0.6)).toBe(0);
      expect(differing(plain, shaded, 0.45, 0.75, 1, 1)).toBeGreaterThan(0);
    } finally {
      await topo.remove();
    }
  }, 150_000);

  it("renders a saved template over a completed topo job", async () => {
    const tiles = stubTileServer("six-topo");
    const templates = await request(API_URL)
      .get("/geo-pdf-templates")
      .set(AUTH);
    expect(templates.status).toBe(200);
    const template = templates.body.find(
      (t: { id: string }) => t.id === seedId("f", 10),
    );
    expect(template).toBeDefined();

    // What Logjam Web does: the template's layout plus the extent on the map.
    const extent = extentFor(template.config);
    const topo = await topoTileUnder(extent, template.config.scale);
    try {
      const { pdf } = await renderGeoPdf({ ...template.config, extent });
      expect(
        tiles.length,
        "a worker container rendered: unset ECS_SUBNETS",
      ).toBeGreaterThan(0);
      const image = await mapImage(pdf);
      // The page is the template's A4 portrait, and its hillshade is painted.
      const page = (await parseGeoPdfGeoref(pdf)).pages[0];
      const a4 = getPaperDimensions({ ...PAPER, ...template.config });
      expect(Math.abs(page.pageWidthPt - a4.w * MM_TO_PT)).toBeLessThan(1);
      expect(Math.abs(page.pageHeightPt - a4.h * MM_TO_PT)).toBeLessThan(1);
      expect(isGrey(colourAt(image, topo.fx, topo.fy))).toBe(true);
    } finally {
      await topo.remove();
    }
  }, 150_000);
});
