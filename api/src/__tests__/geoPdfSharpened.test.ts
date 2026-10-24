import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createCanvas } from "canvas";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";
import {
  extentFromCentreAndSize,
  getMapDimensions,
  latToMercY,
  normalizeUserUiPreferences,
  parseRgbaHex,
  slopeBandAt,
  VECTOR_STYLE_DEFAULTS,
  type ExtentState,
  type GeoPdfConfig,
} from "@logjam/shared";

import {
  singleTilePmtiles,
  tileAt,
  tileBounds,
} from "../../prisma/seedArchives";
import prisma from "../services/prisma";
import { s3 } from "../services/awsClients";
import { logger } from "../lib/logger";
import { generateGeoPdf } from "../services/generateGeoPdf";
import { ALICE_ID, ALICE_SUB, API_URL, BOB_ID, CAROL_ID, as } from "./_actors";
import {
  TILE_GREEN,
  colourAt,
  mapImage,
  realFetch,
  stubTileServer,
} from "./_geoPdfRun";

// A GeoPDF draws a sharpened area's terrain only for its owner and the users
// it is shared with directly, decided when the render starts (ADR 0040): a
// stranger's page, and a revoked sharee's, are the statewide one. The
// renderer (generateGeoPdf, which the GeoPDF task runs) is called here in
// this process for each user, against the running stack (`make dev`), on a
// made-up area of alice's whose slope archive holds one tile at 65°.
//
// Mutations that turn it red: generateGeoPdf reading every completed area
// instead of visibleSharpenedAreas(userId) (carol's page is coloured); not
// routing slope through the area (alice's page is green); drawing a sharpened
// job's slope archive in the legacy-job loop (alice's spot is the raw
// terrarium colour); logging the area's id or key when its archive is missing.

// Katoomba's latitude out in the Tasman Sea: no statewide archive has a tile
// there, so the area's tile is the only thing a page can colour.
const CENTRE: [number, number] = [-33.7126, 155.3119];
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
const map = getMapDimensions(PAPER);
const EXTENT = extentFromCentreAndSize(
  ...CENTRE,
  (map.w / 1000) * PAPER.scale,
  (map.h / 1000) * PAPER.scale,
);
const CONFIG: GeoPdfConfig = {
  paperSize: PAPER.paperSize,
  orientation: PAPER.orientation,
  extent: EXTENT,
  scale: PAPER.scale,
  // OSM goes to z19, so 1:25 000 renders at z16, the area's zmax.
  baseLayer: "osm",
  // Hillshade too, whose heights archive is missing: its failure is logged.
  overlays: ["slope", "hillshade"],
  elements: { compass: false, scaleText: false, scaleBar: false },
};
const { slopeBands } = normalizeUserUiPreferences(undefined);
const DEGREES = 65;

const id = randomUUID();
const slopeKey = `outputs/${id}/slope.pmtiles`;
// The z16 tile a quarter of the way across the page, mid-height.
const centreLat = (EXTENT.north + EXTENT.south) / 2;
const tile = tileAt(
  16,
  EXTENT.west + 0.25 * (EXTENT.east - EXTENT.west),
  centreLat,
);
const [west, south, east, north] = tileBounds(16, tile.x, tile.y);
const SPOT = {
  fx: ((west + east) / 2 - EXTENT.west) / (EXTENT.east - EXTENT.west),
  fy:
    (latToMercY(EXTENT.north) - latToMercY((south + north) / 2)) /
    (latToMercY(EXTENT.north) - latToMercY(EXTENT.south)),
};

/** One tile of terrarium slope: `DEGREES` everywhere. */
function slopePng() {
  const canvas = createCanvas(256, 256);
  const ctx = canvas.getContext("2d");
  const v = DEGREES + 32768;
  ctx.fillStyle = `rgb(${v >> 8},${v & 255},0)`;
  ctx.fillRect(0, 0, 256, 256);
  return canvas.toBuffer("image/png");
}

beforeAll(async () => {
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_TOPO,
      Key: slopeKey,
      Body: singleTilePmtiles({ ...tile, tile: slopePng(), type: "png" }),
    }),
  );
  const z15 = { x: tile.x >> 1, y: tile.y >> 1 };
  await prisma.topoJob.create({
    data: {
      id,
      userId: ALICE_ID,
      status: "complete",
      name: "geoPdfSharpened test",
      sharpen: {
        v: 1,
        zmax: 16,
        tiles15: [z15.x & ~1, z15.y & ~1, z15.x | 1, z15.y | 1],
        coverage: [west, south, east, north],
        ground: "class-2",
        extracted: null,
        credit: "Elevation: derived from a made-up survey. CC BY 3.0 AU.",
        // No heights archive in the bucket: the hillshade read fails.
        keys: { heights: `outputs/${id}/heights.pmtiles`, slope: slopeKey },
        vegetation: false,
      },
    },
  });
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { entityId: id } });
  await prisma.topoJob.deleteMany({ where: { id } });
  await s3.send(
    new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET_TOPO,
      Key: slopeKey,
    }),
  );
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** The colour at the area's tile on `userId`'s page. */
async function spotFor(userId: string) {
  stubTileServer(CONFIG.baseLayer);
  const pdf = await generateGeoPdf(
    CONFIG,
    userId,
    VECTOR_STYLE_DEFAULTS,
    slopeBands,
  );
  return colourAt(await mapImage(pdf), SPOT.fx, SPOT.fy);
}

const near = (a: number[], b: readonly number[]) =>
  a.every((v, i) => Math.abs(v - b[i]!) < 12);

// The band's colour over the flat green base layer.
const [r, g, b, alpha] = parseRgbaHex(slopeBandAt(slopeBands, DEGREES)!.colour);
const COLOURED = [r, g, b].map(
  (c, i) => (c * alpha) / 255 + TILE_GREEN[i]! * (1 - alpha / 255),
);

describe("a GeoPDF over a sharpened area", () => {
  it("draws the area's slope for its owner, and logs nothing that names it", async () => {
    const warn = vi.spyOn(logger, "warn");
    expect(near(await spotFor(ALICE_ID), COLOURED)).toBe(true);
    const logged = JSON.stringify(warn.mock.calls);
    expect(warn).toHaveBeenCalled();
    expect(logged).not.toContain(id);
    expect(logged).not.toContain(`/${tile.x}/`);
  }, 60_000);

  it("draws the statewide terrain for a stranger", async () => {
    expect(near(await spotFor(CAROL_ID), TILE_GREEN)).toBe(true);
  }, 60_000);

  it("draws the area for a user only while it is shared with them", async () => {
    expect(near(await spotFor(BOB_ID), TILE_GREEN)).toBe(true);

    const shared = await request(API_URL)
      .post("/shares")
      .set(as(ALICE_SUB))
      .send({ entityType: "topoJob", entityId: id, sharedWithUserId: BOB_ID });
    expect(shared.status).toBe(201);
    expect(near(await spotFor(BOB_ID), COLOURED)).toBe(true);

    const revoked = await request(API_URL)
      .delete(`/shares/topoJob/${id}/${BOB_ID}`)
      .set(as(ALICE_SUB));
    expect(revoked.status).toBeLessThan(300);
    expect(near(await spotFor(BOB_ID), TILE_GREEN)).toBe(true);
  }, 120_000);
});
