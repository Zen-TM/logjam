import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import prisma from "../services/prisma";
import { s3 } from "../services/awsClients";
import { resultKeyFor } from "../lib/geoPdfResult";
import {
  API_URL,
  ALICE_ID,
  ALICE_SUB,
  BOB_ID,
  BOB_SUB,
  CANYON_TYPE_ID,
  CAROL_SUB,
  MARKER_TYPE_ID,
  SHARED_PLACE_ID,
  as,
} from "./_actors";

// Plans: what a plan holds besides its write-up, its places, routes, files
// and GeoPDFs. alice leads the plan; bob is an active member; carol is not
// in it. Members are written straight to the table, as in plans.test.ts.
//
// Requires `make dev` (Postgres + MiniStack + API). Every plan, place and
// file here is the test's own; the sweep removes them.

const TOPO_BUCKET = process.env.S3_BUCKET_TOPO ?? "";
const GPX = Buffer.from(
  `<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><trkseg>
  <trkpt lat="-33.5" lon="150.4"/><trkpt lat="-33.51" lon="150.41"/>
</trkseg></trk></gpx>`,
  "utf8",
);

let planId: string;

async function membership(
  userId: string,
  role: "leader" | "editor" | "member" = "member",
) {
  await prisma.tripPlanMember.upsert({
    where: { planId_userId: { planId, userId } },
    create: { planId, userId, status: "active", role, invitedById: ALICE_ID },
    update: { status: "active", role },
  });
}

async function used(userId: string): Promise<bigint> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { storageUsedBytes: true },
  });
  return user.storageUsedBytes;
}

async function planUpdatedAt(): Promise<number> {
  const plan = await prisma.tripPlan.findUniqueOrThrow({
    where: { id: planId },
  });
  return plan.updatedAt.getTime();
}

function add(sub: string, body: object) {
  return request(API_URL)
    .post(`/plans/${planId}/items`)
    .set(as(sub))
    .send(body);
}

async function ownPlace(sub: string, extra: object = {}) {
  const res = await request(API_URL)
    .post("/places")
    .set(as(sub))
    .send({
      name: "Test gully",
      latitude: -33.6,
      longitude: 150.3,
      placeTypeId: CANYON_TYPE_ID,
      ...extra,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

/** A standalone import of `sub`'s, uploaded through the real presign flow. */
async function ownFile(sub: string): Promise<string> {
  const body = {
    linkedType: "none",
    origin: "import",
    filename: `plan-test-${Date.now()}.gpx`,
    mediaType: "application/gpx+xml",
    metadata: {
      bbox: [150.4, -33.51, 150.41, -33.5],
      featureCount: 1,
      positionCount: 2,
    },
  };
  const presign = await request(API_URL)
    .post("/media/presign")
    .set(as(sub))
    .send({ ...body, sizeBytes: GPX.length });
  expect(presign.status).toBe(201);
  const put = await fetch(presign.body.displayUploadUrl, {
    method: "PUT",
    headers: { "Content-Type": body.mediaType },
    body: GPX,
  });
  expect(put.ok).toBe(true);
  const confirm = await request(API_URL)
    .post(`/media/${presign.body.mediaId}/confirm`)
    .set(as(sub))
    .send(body);
  expect(confirm.status).toBe(201);
  return presign.body.mediaId as string;
}

/** A completed GeoPDF of alice's, with an object, charged as the worker does. */
async function ownGeoPdf(): Promise<string> {
  const bytes = 1234n;
  const job = await prisma.geoPdfJob.create({
    data: {
      userId: ALICE_ID,
      config: { elements: { title: "Test map" } },
      vectorStyleSnapshot: {},
      status: "completed",
      resultBytes: bytes,
      completedAt: new Date(),
    },
  });
  await s3.send(
    new PutObjectCommand({
      Bucket: TOPO_BUCKET,
      Key: resultKeyFor(job.id),
      Body: Buffer.alloc(Number(bytes)),
    }),
  );
  await prisma.geoPdfJob.update({
    where: { id: job.id },
    data: { resultKey: resultKeyFor(job.id) },
  });
  return job.id;
}

beforeEach(async () => {
  const res = await request(API_URL)
    .post("/plans")
    .set(as(ALICE_SUB))
    .send({ name: "Test items plan" });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  planId = res.body.id;
  await membership(BOB_ID);
});

afterEach(async () => {
  await request(API_URL).delete(`/plans/${planId}`).set(as(ALICE_SUB));
});

describe("POST /plans/:id/items (Add a copy)", () => {
  it("copies an owned place and its route, linked to the plan's copy", async () => {
    const placeId = await ownPlace(ALICE_SUB);
    const route = await request(API_URL)
      .post("/routes")
      .set(as(ALICE_SUB))
      .send({
        name: "Test way",
        placeId,
        points: [
          [150.3, -33.6],
          [150.31, -33.61],
        ],
      });
    expect(route.status, JSON.stringify(route.body)).toBe(201);

    const res = await add(ALICE_SUB, { kind: "place", id: placeId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.item).toMatchObject({
      kind: "place",
      name: "Test gully",
      placeTypeId: CANYON_TYPE_ID,
      addedBy: { id: ALICE_ID, username: "alice" },
    });
    expect(res.body.item.id).not.toBe(placeId);

    const view = await request(API_URL)
      .get(`/plans/${planId}`)
      .set(as(BOB_SUB));
    expect(view.status).toBe(200);
    expect(view.body.places.map((p: { id: string }) => p.id)).toEqual([
      res.body.item.id,
    ]);
    // Mutation: create the plan route with the source's placeId, or none.
    expect(view.body.routes).toMatchObject([
      { kind: "route", name: "Test way", placeId: res.body.item.id },
    ]);
    const planRoute = await prisma.route.findUniqueOrThrow({
      where: { id: view.body.routes[0].id },
    });
    expect(planRoute).toMatchObject({ ownerId: null, planId });

    // The route added on its own comes in unlinked: its place is alice's.
    // Mutation: copy the source's placeId onto a plan route.
    const alone = await add(ALICE_SUB, { kind: "route", id: route.body.id });
    expect(alone.status).toBe(201);
    expect(alone.body.item).toMatchObject({ kind: "route", placeId: null });
  });

  // Mutation: keep the adder's own type on the plan's place.
  it("lands a place of the adder's own type as a Marker, its values parked with labels", async () => {
    const type = await prisma.placeType.create({
      data: {
        ownerId: ALICE_ID,
        name: "Test swimming hole",
        iconKey: "marker",
        color: "#4BB4D9",
      },
    });
    await prisma.customFieldDef.create({
      data: {
        ownerId: ALICE_ID,
        entity: "place",
        key: "test_depth",
        label: "Test depth",
        type: "string",
        placeTypes: { create: { placeTypeId: type.id } },
      },
    });
    const placeId = await ownPlace(ALICE_SUB, {
      placeTypeId: type.id,
      fieldValues: { test_depth: "deep" },
    });

    const res = await add(ALICE_SUB, { kind: "place", id: placeId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.item).toMatchObject({
      placeTypeId: MARKER_TYPE_ID,
      fieldValues: {},
      foreignFields: [
        {
          key: "test_depth",
          label: "Test depth",
          type: "string",
          value: "deep",
        },
      ],
    });

    // Save a copy keeps the parked values: bob has no such definition, so
    // they stay parked, with their label.
    // Mutation: drop the foreignFields arm of reconcileCopiedPlace.
    const saved = await request(API_URL)
      .post(`/plans/${planId}/items/place/${res.body.item.id}/save`)
      .set(as(BOB_SUB))
      .send({});
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    expect(saved.body).toMatchObject({
      ownerId: BOB_ID,
      placeTypeId: MARKER_TYPE_ID,
      forkedFromId: null,
      foreignFields: [
        { key: "test_depth", label: "Test depth", value: "deep" },
      ],
    });
    // The type goes after its place, an order the sweep doesn't know.
    await prisma.place.delete({ where: { id: placeId } });
    await prisma.placeType.delete({ where: { id: type.id } });
  });

  // Mutation: read the source with requirePlaceAccess instead of ownerId.
  it("404s a place shared with the caller, as it does a missing one", async () => {
    const res = await add(BOB_SUB, { kind: "place", id: SHARED_PLACE_ID });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Couldn't find that.");
    expect(await prisma.place.count({ where: { planId } })).toBe(0);
  });

  it("404s someone not in the plan", async () => {
    const placeId = await ownPlace(CAROL_SUB);
    const res = await add(CAROL_SUB, { kind: "place", id: placeId });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Couldn't find that plan.");
  });

  it("refuses a write to an archived plan", async () => {
    await prisma.tripPlan.update({
      where: { id: planId },
      data: { archivedAt: new Date() },
    });
    const placeId = await ownPlace(ALICE_SUB);
    const res = await add(ALICE_SUB, { kind: "place", id: placeId });
    expect(res.status).toBe(409);
  });

  it("refuses a body only a broken client sends", async () => {
    expect((await add(ALICE_SUB, { kind: "trip", id: "x" })).status).toBe(400);
    expect((await add(ALICE_SUB, { kind: "place" })).status).toBe(400);
  });
});

describe("plan files and storage", () => {
  // Mutation: charge nobody, or refund the deleter instead of chargedToId.
  it("charges a file to its adder, and its delete refunds them whoever deletes it", async () => {
    const fileId = await ownFile(BOB_SUB);
    const before = await used(BOB_ID);
    const res = await add(BOB_SUB, { kind: "media", id: fileId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.item).toMatchObject({
      kind: "media",
      sizeBytes: String(GPX.length),
      chargedTo: { id: BOB_ID, username: "bob" },
      item: { linkedType: "none", origin: "import" },
    });
    expect(res.body.item.item.displayUrl).toEqual(expect.any(String));
    expect(await used(BOB_ID)).toBe(before + BigInt(GPX.length));

    const aliceBefore = await used(ALICE_ID);
    const del = await request(API_URL)
      .delete(`/plans/${planId}/items/media/${res.body.item.id}`)
      .set(as(ALICE_SUB));
    expect(del.status).toBe(204);
    expect(await used(BOB_ID)).toBe(before);
    expect(await used(ALICE_ID)).toBe(aliceBefore);
    await request(API_URL).delete(`/media/${fileId}`).set(as(BOB_SUB));
  });

  it("copies a GeoPDF with its own object, and refunds on plan delete", async () => {
    const jobId = await ownGeoPdf();
    const before = await used(ALICE_ID);
    const res = await add(ALICE_SUB, { kind: "geoPdf", id: jobId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.item).toMatchObject({
      kind: "geoPdf",
      title: "Test map",
      sizeBytes: "1234",
      chargedTo: { id: ALICE_ID },
    });
    expect(res.body.item.downloadUrl).toEqual(expect.any(String));
    const copy = await prisma.geoPdfJob.findUniqueOrThrow({
      where: { id: res.body.item.id },
    });
    expect(copy).toMatchObject({ userId: null, planId, status: "completed" });
    expect(copy.resultKey).toBe(resultKeyFor(copy.id));
    expect(await used(ALICE_ID)).toBe(before + 1234n);

    // Guard: deleting the plan refunds. Mutation: drop refund() in
    // deletePlanWithFiles, leaving the cascade to take the rows.
    const del = await request(API_URL)
      .delete(`/plans/${planId}`)
      .set(as(ALICE_SUB));
    expect(del.status).toBe(204);
    expect(await used(ALICE_ID)).toBe(before);
    await prisma.geoPdfJob.delete({ where: { id: jobId } });
  });

  it("refuses a GeoPDF that is still being made", async () => {
    const job = await prisma.geoPdfJob.create({
      data: {
        userId: ALICE_ID,
        config: {},
        vectorStyleSnapshot: {},
        status: "running",
      },
    });
    const res = await add(ALICE_SUB, { kind: "geoPdf", id: job.id });
    expect(res.status).toBe(409);
    await prisma.geoPdfJob.delete({ where: { id: job.id } });
  });

  it("refuses a file past the adder's quota and leaves nothing behind", async () => {
    const fileId = await ownFile(BOB_SUB);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: BOB_ID } });
    await prisma.user.update({
      where: { id: BOB_ID },
      data: { storageQuotaBytes: user.storageUsedBytes },
    });
    try {
      const res = await add(BOB_SUB, { kind: "media", id: fileId });
      expect(res.status).toBe(507);
      expect(await prisma.media.count({ where: { planId } })).toBe(0);
    } finally {
      await prisma.user.update({
        where: { id: BOB_ID },
        data: { storageQuotaBytes: user.storageQuotaBytes },
      });
      await request(API_URL).delete(`/media/${fileId}`).set(as(BOB_SUB));
    }
  });
});

describe("Save a copy", () => {
  async function planFile(): Promise<string> {
    const fileId = await ownFile(ALICE_SUB);
    const res = await add(ALICE_SUB, { kind: "media", id: fileId });
    expect(res.status).toBe(201);
    await request(API_URL).delete(`/media/${fileId}`).set(as(ALICE_SUB));
    return res.body.item.id;
  }

  it("gives a member their own copy, charged to them", async () => {
    const id = await planFile();
    const before = await used(BOB_ID);
    const res = await request(API_URL)
      .post(`/plans/${planId}/items/media/${id}/save`)
      .set(as(BOB_SUB))
      .send({});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ linkedType: "none", origin: "import" });
    const row = await prisma.media.findUniqueOrThrow({
      where: { id: res.body.id },
    });
    expect(row).toMatchObject({ ownerId: BOB_ID, planId: null });
    expect(row.s3KeyDisplay.startsWith(`media/${BOB_ID}/`)).toBe(true);
    expect(await used(BOB_ID)).toBe(before + BigInt(GPX.length));
    await request(API_URL).delete(`/media/${res.body.id}`).set(as(BOB_SUB));
  });

  // Mutation: requirePlanMember → a check that the item exists.
  it("404s someone never in the plan and a removed member", async () => {
    const id = await planFile();
    const carol = await request(API_URL)
      .post(`/plans/${planId}/items/media/${id}/save`)
      .set(as(CAROL_SUB))
      .send({});
    expect(carol.status).toBe(404);
    await prisma.tripPlanMember.delete({
      where: { planId_userId: { planId, userId: BOB_ID } },
    });
    const bob = await request(API_URL)
      .post(`/plans/${planId}/items/media/${id}/save`)
      .set(as(BOB_SUB))
      .send({});
    expect(bob.status).toBe(404);
  });

  it("copies a route out unlinked", async () => {
    const route = await request(API_URL)
      .post("/routes")
      .set(as(ALICE_SUB))
      .send({
        name: "Test way",
        points: [
          [150.3, -33.6],
          [150.31, -33.61],
        ],
      });
    const added = await add(ALICE_SUB, { kind: "route", id: route.body.id });
    expect(added.status).toBe(201);
    const res = await request(API_URL)
      .post(`/plans/${planId}/items/route/${added.body.item.id}/save`)
      .set(as(BOB_SUB))
      .send({});
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ownerId: BOB_ID, placeId: null });
    await request(API_URL).delete(`/routes/${res.body.id}`).set(as(BOB_SUB));
    await request(API_URL)
      .delete(`/routes/${route.body.id}`)
      .set(as(ALICE_SUB));
  });
});

describe("DELETE /plans/:id/items/:kind/:itemId", () => {
  // Mutation: canChangeItem always true.
  it("lets a member delete what they added and refuses what others added", async () => {
    const alicePlace = await add(ALICE_SUB, {
      kind: "place",
      id: await ownPlace(ALICE_SUB),
    });
    const bobPlace = await add(BOB_SUB, {
      kind: "place",
      id: await ownPlace(BOB_SUB),
    });
    const refused = await request(API_URL)
      .delete(`/plans/${planId}/items/place/${alicePlace.body.item.id}`)
      .set(as(BOB_SUB));
    expect(refused.status).toBe(403);
    const own = await request(API_URL)
      .delete(`/plans/${planId}/items/place/${bobPlace.body.item.id}`)
      .set(as(BOB_SUB));
    expect(own.status).toBe(204);
    await membership(BOB_ID, "editor");
    const asEditor = await request(API_URL)
      .delete(`/plans/${planId}/items/place/${alicePlace.body.item.id}`)
      .set(as(BOB_SUB));
    expect(asEditor.status).toBe(204);
    expect(await prisma.place.count({ where: { planId } })).toBe(0);
  });

  it("404s an item of another kind or plan", async () => {
    const added = await add(ALICE_SUB, {
      kind: "place",
      id: await ownPlace(ALICE_SUB),
    });
    for (const path of [
      `route/${added.body.item.id}`,
      `trip/${added.body.item.id}`,
      `place/${SHARED_PLACE_ID}`,
    ]) {
      const res = await request(API_URL)
        .delete(`/plans/${planId}/items/${path}`)
        .set(as(ALICE_SUB));
      expect(res.status, path).toBe(404);
    }
  });
});

// Mutation: drop touchPlan from addPlanItem's or deletePlanItem's transaction.
it("moves the plan's updatedAt on an add and a delete", async () => {
  const placeId = await ownPlace(ALICE_SUB);
  let before = await planUpdatedAt();
  const added = await add(ALICE_SUB, { kind: "place", id: placeId });
  expect(added.status).toBe(201);
  expect(await planUpdatedAt()).toBeGreaterThan(before);
  before = await planUpdatedAt();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const del = await request(API_URL)
    .delete(`/plans/${planId}/items/place/${added.body.item.id}`)
    .set(as(ALICE_SUB));
  expect(del.status).toBe(204);
  expect(await planUpdatedAt()).toBeGreaterThan(before);
});
