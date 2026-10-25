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
  lineVectorTile,
  singleTilePmtiles,
  tileAt,
  tileBounds,
} from "../../prisma/seedArchives";
import prisma from "../services/prisma";
import { s3 } from "../services/awsClients";
import { logger } from "../lib/logger";
import { generateGeoPdf } from "../services/generateGeoPdf";
import { terrainCreditLines } from "../services/geoPdfTerrain";
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
// made-up area of alice's whose slope archive holds one tile at 65° and whose
// contour archive holds one z14 tile with one line through the spot.
//
// Mutations that turn it red: generateGeoPdf reading every completed area
// instead of visibleSharpenedAreas(userId) (carol's page is coloured); not
// routing slope or contours through the area (alice's page is green); not
// crediting the area for a layer it drew, or crediting it for one it did not
// (the credited layers); reading slope from `outputs/<job>/slope.pmtiles` instead of the
// area's archive; logging the
// area's id or key when its archive is missing.

// The credit lines are worded in geoPdfTerrain.unit.test.ts; this file checks
// which layers each area is credited for.
vi.mock("../services/geoPdfTerrain", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/geoPdfTerrain")>();
  return { ...actual, terrainCreditLines: vi.fn(actual.terrainCreditLines) };
});

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

// Contours are drawn over imagery (or the vector basemap), not over OSM.
const CONTOURS: GeoPdfConfig = {
  ...CONFIG,
  baseLayer: "six-imagery",
  overlays: ["contours"],
};

const id = randomUUID();
const slopeKey = `outputs/${id}/slope.pmtiles`;
const contoursKey = `outputs/${id}/contours.pmtiles`;
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

// The area's z14 contour tile, and one line across it at the spot's latitude.
const tile14 = { z: 14, x: tile.x >> 2, y: tile.y >> 2 };
const [, south14, , north14] = tileBounds(14, tile14.x, tile14.y);
const lineY = Math.round(
  ((latToMercY(north14) - latToMercY((south + north) / 2)) /
    (latToMercY(north14) - latToMercY(south14))) *
    4096,
);

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
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_TOPO,
      Key: contoursKey,
      Body: singleTilePmtiles({
        ...tile14,
        tile: lineVectorTile("contours", [
          [0, lineY],
          [4096, lineY],
        ]),
        type: "mvt",
      }),
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
        keys: {
          heights: `outputs/${id}/heights.pmtiles`,
          slope: slopeKey,
          contours: contoursKey,
        },
        vegetation: false,
      },
    },
  });
});

afterAll(async () => {
  await prisma.share.deleteMany({ where: { entityId: id } });
  await prisma.topoJob.deleteMany({ where: { id } });
  for (const Key of [slopeKey, contoursKey]) {
    await s3.send(
      new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET_TOPO, Key }),
    );
  }
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** `userId`'s page, and the layers it credits the area for (none: undefined). */
async function render(config: GeoPdfConfig, userId: string) {
  stubTileServer(config.baseLayer);
  vi.mocked(terrainCreditLines).mockClear();
  const pdf = await generateGeoPdf(
    config,
    userId,
    VECTOR_STYLE_DEFAULTS,
    slopeBands,
  );
  const areas = vi.mocked(terrainCreditLines).mock.lastCall![1];
  const credited = [...areas].find(([area]) => area.id === id)?.[1];
  return {
    image: await mapImage(pdf),
    credited: credited && [...credited].sort(),
  };
}

/** The colour at the area's tile on `userId`'s slope page. */
async function spotFor(userId: string) {
  const { image } = await render(CONFIG, userId);
  return colourAt(image, SPOT.fx, SPOT.fy);
}

/** Whether `userId`'s contour page has the area's line at the spot. */
async function lineFor(userId: string) {
  const { image, credited } = await render(CONTOURS, userId);
  // The line is white over imagery; the base layer's green is not.
  const { data } = image
    .getContext("2d")
    .getImageData(SPOT.fx * image.width - 2, SPOT.fy * image.height - 8, 4, 16);
  let brightest = 0;
  for (let i = 0; i < data.length; i += 4) {
    brightest = Math.max(
      brightest,
      Math.min(data[i]!, data[i + 1]!, data[i + 2]!),
    );
  }
  return { drawn: brightest > 220, credited };
}

const near = (a: number[], b: readonly number[]) =>
  a.every((v, i) => Math.abs(v - b[i]!) < 12);

// The band's colour over the flat green base layer.
const [r, g, b, alpha] = parseRgbaHex(slopeBandAt(slopeBands, DEGREES)!.colour);
const COLOURED = [r, g, b].map(
  (c, i) => (c * alpha) / 255 + TILE_GREEN[i]! * (1 - alpha / 255),
);

describe("a GeoPDF over a sharpened area", () => {
  it("draws the area's slope and contours for its owner, and logs nothing that names it", async () => {
    const warn = vi.spyOn(logger, "warn");
    const slope = await render(CONFIG, ALICE_ID);
    expect(near(colourAt(slope.image, SPOT.fx, SPOT.fy), COLOURED)).toBe(true);
    // Its hillshade read failed, so the area is credited for slope only.
    expect(slope.credited).toEqual(["slope"]);
    expect(await lineFor(ALICE_ID)).toEqual({
      drawn: true,
      credited: ["contours"],
    });
    const logged = JSON.stringify(warn.mock.calls);
    expect(warn).toHaveBeenCalled();
    expect(logged).not.toContain(id);
    expect(logged).not.toContain(`/${tile.x}/`);
  }, 60_000);

  it("draws the statewide terrain for a stranger", async () => {
    expect(near(await spotFor(CAROL_ID), TILE_GREEN)).toBe(true);
    expect(await lineFor(CAROL_ID)).toEqual({
      drawn: false,
      credited: undefined,
    });
  }, 60_000);

  it("draws the area for a user only while it is shared with them", async () => {
    expect(near(await spotFor(BOB_ID), TILE_GREEN)).toBe(true);

    const shared = await request(API_URL)
      .post("/shares")
      .set(as(ALICE_SUB))
      .send({ entityType: "topoJob", entityId: id, sharedWithUserId: BOB_ID });
    expect(shared.status).toBe(201);
    expect(near(await spotFor(BOB_ID), COLOURED)).toBe(true);
    expect((await lineFor(BOB_ID)).drawn).toBe(true);

    const revoked = await request(API_URL)
      .delete(`/shares/topoJob/${id}/${BOB_ID}`)
      .set(as(ALICE_SUB));
    expect(revoked.status).toBeLessThan(300);
    expect(near(await spotFor(BOB_ID), TILE_GREEN)).toBe(true);
    expect((await lineFor(BOB_ID)).drawn).toBe(false);
  }, 120_000);
});
