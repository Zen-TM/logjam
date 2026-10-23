import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { NSW_5M } from "@logjam/shared";

import {
  flatPng,
  singleTilePmtiles,
  tileAt,
  tileBounds,
} from "../../prisma/seedArchives";
import prisma from "../services/prisma";
import { s3 } from "../services/awsClients";
import {
  ALICE_ID,
  ALICE_SUB,
  API_URL,
  BOB_ID,
  BOB_SUB,
  CAROL_SUB,
  as,
} from "./_actors";

// A sharpened area is read only by its owner and the users it is shared with
// directly (ADR 0040): a stranger's height is the statewide one, and a revoked
// share reads statewide again. End to end against the running API (`make
// dev`), on a made-up one-tile archive in MiniStack.
//
// Mutations that turn it red: visibleSharpenedAreas without the owner/share
// filter (carol reads alice's area), /elevation sampling without the caller's
// areas (alice reads statewide), and completed-overlays emitting the archive
// keys to a sharee.

const FIXTURES = join(__dirname, "../../../shared/src/__fixtures__");
// Inside the NSW fixture archive, so no request leaves the machine.
const POINT: [number, number] = [150.3105, -33.7005];
const CREDIT = "Elevation: derived from a made-up survey. CC BY 3.0 AU.";

const id = randomUUID();
const heightsKey = `outputs/${id}/heights.pmtiles`;

beforeAll(async () => {
  const put = (Key: string, Body: Buffer) =>
    s3.send(
      new PutObjectCommand({ Bucket: process.env.S3_BUCKET_TOPO, Key, Body }),
    );
  await put(
    NSW_5M.archivePath,
    readFileSync(join(FIXTURES, "nsw-5m-z15-katoomba.pmtiles")),
  );
  // One flat z16 tile: grey 128 decodes to 128.5 m, far from the ~980 m of
  // the statewide fixture there.
  const tile = tileAt(16, ...POINT);
  await put(
    heightsKey,
    singleTilePmtiles({ ...tile, tile: flatPng(128), type: "png" }),
  );
  const z15 = { x: tile.x >> 1, y: tile.y >> 1 };
  await prisma.topoJob.create({
    data: {
      id,
      userId: ALICE_ID,
      status: "complete",
      name: "sharpened area test",
      sharpen: {
        v: 1,
        zmax: 16,
        tiles15: [z15.x & ~1, z15.y & ~1, z15.x | 1, z15.y | 1],
        coverage: [...tileBounds(16, tile.x, tile.y)],
        ground: "class-2",
        extracted: null,
        credit: CREDIT,
        keys: { heights: heightsKey, slope: `outputs/${id}/slope.pmtiles` },
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
      Key: heightsKey,
    }),
  );
});

const heightFor = async (sub: string) => {
  const res = await request(API_URL)
    .post("/elevation/point")
    .set(as(sub))
    .send({ point: POINT });
  expect(res.status).toBe(200);
  return res.body as {
    elevationM: number;
    demSourceIds: string[];
    attribution: string;
  };
};

const overlayFor = async (sub: string) => {
  const res = await request(API_URL)
    .get("/topo-jobs/completed-overlays")
    .set(as(sub));
  expect(res.status).toBe(200);
  return (res.body.jobs as { jobId: string; sharpened?: object }[]).find(
    (job) => job.jobId === id,
  );
};

describe("a sharpened area", () => {
  it("answers its owner's height, credited to the survey and the 5 m data", async () => {
    const body = await heightFor(ALICE_SUB);
    expect(body.demSourceIds[0]).toBe(`lidar-${id}`);
    expect(body.elevationM).toBeCloseTo(128.5, 1);
    expect(body.attribution).toContain(CREDIT);
    expect(body.attribution).toContain(NSW_5M.credit);
  });

  it("is the statewide height to a stranger, worded as anywhere else", async () => {
    const body = await heightFor(CAROL_SUB);
    expect(body.demSourceIds).toEqual([NSW_5M.id]);
    expect(body.attribution).not.toContain(CREDIT);
    expect(await overlayFor(CAROL_SUB)).toBeUndefined();
  });

  it("reaches a user only while it is shared with them", async () => {
    expect((await heightFor(BOB_SUB)).demSourceIds).toEqual([NSW_5M.id]);

    const shared = await request(API_URL)
      .post("/shares")
      .set(as(ALICE_SUB))
      .send({ entityType: "topoJob", entityId: id, sharedWithUserId: BOB_ID });
    expect(shared.status).toBe(201);
    expect((await heightFor(BOB_SUB)).demSourceIds[0]).toBe(`lidar-${id}`);
    const overlay = await overlayFor(BOB_SUB);
    expect(overlay?.sharpened).toMatchObject({
      id,
      zmax: 16,
      contours: false,
      credit: CREDIT,
      contoursUrl: null,
    });
    expect(overlay?.sharpened).toHaveProperty("heightsUrl");
    expect(overlay?.sharpened).not.toHaveProperty("keys");

    const revoked = await request(API_URL)
      .delete(`/shares/topoJob/${id}/${BOB_ID}`)
      .set(as(ALICE_SUB));
    expect(revoked.status).toBeLessThan(300);
    expect((await heightFor(BOB_SUB)).demSourceIds).toEqual([NSW_5M.id]);
    expect(await overlayFor(BOB_SUB)).toBeUndefined();
  });
});
