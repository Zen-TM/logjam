import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { Canvas } from "canvas";
import {
  extentFromCentreAndSize,
  getMapDimensions,
  getPaperDimensions,
  NSW_5M,
  type ExtentState,
  type GeoPdfConfig,
} from "@logjam/shared";
import {
  TILE_GREEN,
  colourAt,
  mapImage,
  realFetch,
  renderGeoPdf,
  stubTileServer,
} from "./_geoPdfRun";
// Subpath import: geoPdfImport is kept out of the shared barrel (pdf-lib).
import { parseGeoPdfGeoref } from "@logjam/shared/dist/geoPdfImport/parseGeoref.js";
import {
  flatPng,
  singleTilePmtiles,
  tileAt,
  tileBounds,
} from "../../prisma/seedArchives";
import prisma from "../services/prisma";
import { s3 } from "../services/awsClients";
import { latToMercY, computeZoom, TARGET_DPI } from "@logjam/shared";
import { ALICE_ID } from "./_actors";

// Requires the topo bucket. Each test makes its own completed topo job, with
// ONE vegetation tile in S3 at the zoom the page renders at: a GeoPDF reads overlays at its
// print zoom (z16 or deeper at 1:25,000), which a tile at any other zoom
// would not answer. The worker reads the archive from S3
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
};
// Katoomba's latitude, out in the Tasman Sea: no statewide archive has a tile
// there, so a job's overlay is the only thing a page can paint, whatever a
// developer or another test file left at the `master/` keys.
const OFFSHORE: [number, number] = [-33.7126, 155.3119];
// The committed Katoomba slice of the statewide heights covers part of a page
// centred here.
const KATOOMBA: [number, number] = [-33.7126, 150.3119];

/** The extent Logjam Web computes for a paper and scale around a centre. */
function extentFor(paper: Partial<ExtentState>, [lat, lon] = OFFSHORE) {
  const state = { ...PAPER, ...paper };
  const map = getMapDimensions(state);
  return extentFromCentreAndSize(
    lat,
    lon,
    (map.w / 1000) * state.scale,
    (map.h / 1000) * state.scale,
  );
}
const EXTENT = extentFor({});

type Extent = typeof EXTENT;

/**
 * A completed topo job of alice's with one vegetation tile under the 25%-across,
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
  const key = `outputs/${id}/vegetation.pmtiles`;
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
      s3OutputKeys: [{ name: "vegetation", cogKey: null, pmtilesKey: key }],
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
  it("paints the job's vegetation from S3 and credits its source", async () => {
    const tiles = stubTileServer(BASE_LAYER);
    const topo = await topoTileUnder(EXTENT, CONFIG.scale);
    try {
      const plain = await mapImage((await renderGeoPdf(CONFIG)).pdf);
      const shaded = await mapImage(
        (await renderGeoPdf({ ...CONFIG, overlays: ["vegetation"] })).pdf,
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
      // by the LiDAR credit (bottom right), nowhere above it off the tile.
      expect(differing(plain, shaded, 0.5, 0, 1, 0.6)).toBe(0);
      expect(differing(plain, shaded, 0.45, 0.75, 1, 1)).toBeGreaterThan(0);
    } finally {
      await topo.remove();
    }
  }, 150_000);

  it("renders a stored layout over a completed topo job", async () => {
    const tiles = stubTileServer("six-topo");
    // What Logjam Web sends: the dialog's layout plus the extent on the map.
    const layout = {
      paperSize: "A4",
      orientation: "portrait",
      scale: 25000,
      baseLayer: "six-topo",
      overlays: ["hillshade"],
      elements: { compass: true, scaleText: true, scaleBar: true },
    } as const;
    const extent = extentFor(layout);
    const topo = await topoTileUnder(extent, layout.scale);
    try {
      const { pdf } = await renderGeoPdf({
        ...layout,
        overlays: [...layout.overlays, "vegetation"],
        extent,
      });
      expect(
        tiles.length,
        "a worker container rendered: unset ECS_SUBNETS",
      ).toBeGreaterThan(0);
      const image = await mapImage(pdf);
      // The page is the layout's A4 portrait, and the job's vegetation is painted.
      const page = (await parseGeoPdfGeoref(pdf)).pages[0];
      const a4 = getPaperDimensions({ ...PAPER, ...layout });
      expect(Math.abs(page.pageWidthPt - a4.w * MM_TO_PT)).toBeLessThan(1);
      expect(Math.abs(page.pageHeightPt - a4.h * MM_TO_PT)).toBeLessThan(1);
      expect(isGrey(colourAt(image, topo.fx, topo.fy))).toBe(true);
    } finally {
      await topo.remove();
    }
  }, 150_000);
});

// The statewide hillshade anywhere a page has heights, with no job, and its
// credit. Mutation: skip the statewide hillshade, or leave `terrainCredit`
// out of the attribution: the region, or the credit block, stays unchanged.
describe("GeoPDF over the statewide heights (alice)", () => {
  it("shades the ground and credits the NSW 5 m DEM", async () => {
    const tiles = stubTileServer(BASE_LAYER);
    const fixture = join(
      __dirname,
      "../../../shared/src/__fixtures__/nsw-5m-z15-katoomba.pmtiles",
    );
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_TOPO,
        Key: NSW_5M.archivePath,
        Body: readFileSync(fixture),
      }),
    );
    // Left in place afterwards, as elevation.test.ts leaves it: a developer's
    // stack then still has heights at Katoomba.
    const extent = extentFor({}, KATOOMBA);
    const config = { ...CONFIG, extent };
    const plain = await mapImage((await renderGeoPdf(config)).pdf);
    const shaded = await mapImage(
      (await renderGeoPdf({ ...config, overlays: ["hillshade"] })).pdf,
    );
    expect(
      tiles.length,
      "a worker container rendered: unset ECS_SUBNETS",
    ).toBeGreaterThan(0);

    // The slice spans 150.311–150.329 E, 33.700–33.705 S: the top of the
    // page, from about a third of the way across. Nothing is drawn below it.
    const fx = (lon: number) =>
      (lon - extent.west) / (extent.east - extent.west);
    const fy = (lat: number) =>
      (latToMercY(extent.north) - latToMercY(lat)) /
      (latToMercY(extent.north) - latToMercY(extent.south));
    expect(
      differing(plain, shaded, fx(150.313), 0, fx(150.327), fy(-33.704)),
    ).toBeGreaterThan(0);
    expect(differing(plain, shaded, 0, 0.4, 0.4, 0.7)).toBe(0);
    expect(differing(plain, shaded, 0.45, 0.75, 1, 1)).toBeGreaterThan(0);
  }, 150_000);
});
