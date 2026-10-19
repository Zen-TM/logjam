import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import prisma from "../services/prisma";
import { s3 } from "../services/awsClients";
import { randomUUID } from "crypto";
import { planResultKeyFor, resultKeyFor } from "../lib/geoPdfResult";
import { copyStandaloneFile, handOverPlans } from "../lib/planItems";
import {
  API_URL,
  ALICE_ID,
  ALICE_SUB,
  BOB_ID,
  BOB_SUB,
  CANYON_TYPE_ID,
  CAROL_ID,
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
const MEDIA_BUCKET = process.env.S3_BUCKET_MEDIA ?? "";
const GPX = Buffer.from(
  `<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><trkseg>
  <trkpt lat="-33.5" lon="150.4"/><trkpt lat="-33.51" lon="150.41"/>
</trkseg></trk></gpx>`,
  "utf8",
);

// A 1x1 PNG; the server reads only the object's size.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
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

async function ownRoute(sub: string): Promise<string> {
  const res = await request(API_URL)
    .post("/routes")
    .set(as(sub))
    .send({
      name: "Test way",
      points: [
        [150.3, -33.6],
        [150.31, -33.61],
      ],
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

/** A photo on `sub`'s place, uploaded through the real presign flow. */
async function ownPhoto(sub: string, placeId: string): Promise<string> {
  const body = {
    linkedType: "place",
    linkedId: placeId,
    filename: "test-photo.png",
    mediaType: "image/png",
  };
  const presign = await request(API_URL)
    .post("/media/presign")
    .set(as(sub))
    .send({ ...body, sizeBytes: PNG.length, thumbnailSizeBytes: PNG.length });
  expect(presign.status, JSON.stringify(presign.body)).toBe(201);
  for (const [url, type] of [
    [presign.body.displayUploadUrl, "image/png"],
    [presign.body.thumbnailUploadUrl, "image/jpeg"],
  ]) {
    const put = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": type },
      body: PNG,
    });
    expect(put.ok).toBe(true);
  }
  const confirm = await request(API_URL)
    .post(`/media/${presign.body.mediaId}/confirm`)
    .set(as(sub))
    .send(body);
  expect(confirm.status, JSON.stringify(confirm.body)).toBe(201);
  return presign.body.mediaId as string;
}

/** A completed GeoPDF of alice's, with an object, uncharged (the worker would charge it). */
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

  // Mutation: requirePlanWrite → a plan-exists check.
  it("404s someone not in the plan", async () => {
    const placeId = await ownPlace(CAROL_SUB);
    const res = await add(CAROL_SUB, { kind: "place", id: placeId });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Couldn't find that plan.");
  });

  // Mutation: drop ownerId (route, media) or userId (geoPdf) from that arm of
  // addPlanItem.
  it("404s a route, file or GeoPDF someone else owns", async () => {
    const routeId = await ownRoute(ALICE_SUB);
    const fileId = await ownFile(ALICE_SUB);
    const jobId = await ownGeoPdf();
    for (const [kind, id] of [
      ["route", routeId],
      ["media", fileId],
      ["geoPdf", jobId],
    ]) {
      const res = await add(BOB_SUB, { kind, id });
      expect(res.status, kind).toBe(404);
    }
    expect(await prisma.route.count({ where: { planId } })).toBe(0);
    expect(await prisma.media.count({ where: { planId } })).toBe(0);
    expect(await prisma.geoPdfJob.count({ where: { planId } })).toBe(0);
    await request(API_URL).delete(`/routes/${routeId}`).set(as(ALICE_SUB));
    await request(API_URL).delete(`/media/${fileId}`).set(as(ALICE_SUB));
    await prisma.geoPdfJob.delete({ where: { id: jobId } });
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

  // Mutation: link the copy to the source place (targetPlaceId: place.id) in
  // addPlace, which would hand plan photos to the place's sharees.
  it("copies a place's photos onto the plan's place, charged to the adder", async () => {
    const placeId = await ownPlace(ALICE_SUB);
    const photoId = await ownPhoto(ALICE_SUB, placeId);
    const before = await used(ALICE_ID);
    const res = await add(ALICE_SUB, {
      kind: "place",
      id: placeId,
      copyMedia: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.mediaCopied).toBe(1);
    const planPlaceId = res.body.item.id;
    const copy = await prisma.media.findFirstOrThrow({ where: { planId } });
    expect(copy).toMatchObject({
      ownerId: null,
      linkedType: "place",
      linkedId: planPlaceId,
      addedById: ALICE_ID,
      chargedToId: ALICE_ID,
    });
    expect(copy.id).not.toBe(photoId);
    expect(await prisma.media.count({ where: { linkedId: placeId } })).toBe(1);
    expect(await used(ALICE_ID)).toBe(before + copy.fileSizeBytes);

    const view = await request(API_URL)
      .get(`/plans/${planId}`)
      .set(as(BOB_SUB));
    expect(view.status).toBe(200);
    expect(view.body.places[0].media).toMatchObject([
      { id: copy.id, chargedTo: { id: ALICE_ID } },
    ]);
    expect(view.body.places[0].media[0].displayUrl).toEqual(expect.any(String));

    // Mutation: drop deleteMediaReturning from deletePlanItem's place arm.
    const del = await request(API_URL)
      .delete(`/plans/${planId}/items/place/${planPlaceId}`)
      .set(as(ALICE_SUB));
    expect(del.status).toBe(204);
    expect(await prisma.media.count({ where: { id: copy.id } })).toBe(0);
    expect(await used(ALICE_ID)).toBe(before);
    await request(API_URL).delete(`/media/${photoId}`).set(as(ALICE_SUB));
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
    // Guard: outside the bucket's 7-day `exports/` expiry. Mutation: copy
    // into a plan at resultKeyFor in copyGeoPdf.
    expect(copy.resultKey).toBe(planResultKeyFor(copy.id));
    await s3.send(
      new HeadObjectCommand({ Bucket: TOPO_BUCKET, Key: copy.resultKey! }),
    );
    expect(await used(ALICE_ID)).toBe(before + 1234n);

    // Saved out, it is an owned export again, under the export TTL.
    const bobBefore = await used(BOB_ID);
    const saved = await request(API_URL)
      .post(`/plans/${planId}/items/geoPdf/${copy.id}/save`)
      .set(as(BOB_SUB))
      .send({});
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    const own = await prisma.geoPdfJob.findUniqueOrThrow({
      where: { id: saved.body.id },
    });
    expect(own).toMatchObject({ userId: BOB_ID, planId: null });
    expect(own.resultKey).toBe(resultKeyFor(own.id));
    expect(await used(BOB_ID)).toBe(bobBefore + 1234n);
    await request(API_URL).delete(`/geo-pdf/${own.id}`).set(as(BOB_SUB));

    // Guard: deleting the plan refunds. Mutation: drop refund() in
    // deletePlanWithFiles, leaving the cascade to take the rows.
    const del = await request(API_URL)
      .delete(`/plans/${planId}`)
      .set(as(ALICE_SUB));
    expect(del.status).toBe(204);
    expect(await used(ALICE_ID)).toBe(before);
    await expect(
      s3.send(
        new HeadObjectCommand({ Bucket: TOPO_BUCKET, Key: copy.resultKey! }),
      ),
    ).rejects.toThrow();
    await prisma.geoPdfJob.delete({ where: { id: jobId } });
  });

  // Mutation: rethrow the CopyObject error in copyGeoPdf (a 500).
  it("answers 502 when S3 won't copy a GeoPDF, leaving nothing behind", async () => {
    const jobId = await ownGeoPdf();
    await s3.send(
      new DeleteObjectCommand({
        Bucket: TOPO_BUCKET,
        Key: resultKeyFor(jobId),
      }),
    );
    const before = await used(ALICE_ID);
    const res = await add(ALICE_SUB, { kind: "geoPdf", id: jobId });
    expect(res.status, JSON.stringify(res.body)).toBe(502);
    expect(await prisma.geoPdfJob.count({ where: { planId } })).toBe(0);
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

  // Mutation: drop assertHasStorageQuota from copyStandaloneFile and the
  // re-check in chargeAndWrite. The re-check alone matters only when two adds
  // race past the preflight, which this suite doesn't stage.
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

  // Mutation: drop planId from one of the Save route's findFirst calls.
  it("404s an item that isn't in this plan", async () => {
    const bobsPlaces = await prisma.place.count({ where: { ownerId: BOB_ID } });
    const owned = {
      place: await ownPlace(ALICE_SUB),
      route: await ownRoute(ALICE_SUB),
      media: await ownFile(ALICE_SUB),
      geoPdf: await ownGeoPdf(),
    };
    for (const [kind, id] of Object.entries(owned)) {
      const res = await request(API_URL)
        .post(`/plans/${planId}/items/${kind}/${id}/save`)
        .set(as(BOB_SUB))
        .send({});
      expect(res.status, kind).toBe(404);
    }

    // An item of a plan bob isn't in, asked for through his own.
    const other = await request(API_URL)
      .post("/plans")
      .set(as(ALICE_SUB))
      .send({ name: "Test other plan" });
    expect(other.status).toBe(201);
    const inOther = await request(API_URL)
      .post(`/plans/${other.body.id}/items`)
      .set(as(ALICE_SUB))
      .send({ kind: "place", id: owned.place });
    expect(inOther.status).toBe(201);
    const res = await request(API_URL)
      .post(`/plans/${planId}/items/place/${inOther.body.item.id}/save`)
      .set(as(BOB_SUB))
      .send({});
    expect(res.status).toBe(404);
    expect(await prisma.place.count({ where: { ownerId: BOB_ID } })).toBe(
      bobsPlaces,
    );

    await request(API_URL).delete(`/plans/${other.body.id}`).set(as(ALICE_SUB));
    await request(API_URL).delete(`/routes/${owned.route}`).set(as(ALICE_SUB));
    await request(API_URL).delete(`/media/${owned.media}`).set(as(ALICE_SUB));
    await prisma.geoPdfJob.delete({ where: { id: owned.geoPdf } });
  });

  it("copies a route out unlinked", async () => {
    const routeId = await ownRoute(ALICE_SUB);
    const added = await add(ALICE_SUB, { kind: "route", id: routeId });
    expect(added.status).toBe(201);
    const res = await request(API_URL)
      .post(`/plans/${planId}/items/route/${added.body.item.id}/save`)
      .set(as(BOB_SUB))
      .send({});
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ownerId: BOB_ID, placeId: null });
    await request(API_URL).delete(`/routes/${res.body.id}`).set(as(BOB_SUB));
    await request(API_URL).delete(`/routes/${routeId}`).set(as(ALICE_SUB));
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

  // Mutation: drop planId from planRow's and deletePlanItem's where.
  it("404s an item of another kind, or not in this plan", async () => {
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

// Mutation: drop touchPlan from addPlace's or the route arm's transaction,
// from chargeAndWrite (media, GeoPDF), or from deletePlanItem's.
it("moves the plan's updatedAt on an add of each kind and a delete", async () => {
  const sources = {
    place: await ownPlace(ALICE_SUB),
    route: await ownRoute(ALICE_SUB),
    media: await ownFile(ALICE_SUB),
    geoPdf: await ownGeoPdf(),
  };
  let before = 0;
  let added: request.Response | undefined;
  for (const [kind, id] of Object.entries(sources)) {
    before = await planUpdatedAt();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const res = await add(ALICE_SUB, { kind, id });
    expect(res.status, kind).toBe(201);
    expect(await planUpdatedAt(), kind).toBeGreaterThan(before);
    if (kind === "place") added = res;
  }
  await request(API_URL).delete(`/routes/${sources.route}`).set(as(ALICE_SUB));
  await request(API_URL).delete(`/media/${sources.media}`).set(as(ALICE_SUB));
  await prisma.geoPdfJob.delete({ where: { id: sources.geoPdf } });

  before = await planUpdatedAt();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const del = await request(API_URL)
    .delete(`/plans/${planId}/items/place/${added!.body.item.id}`)
    .set(as(ALICE_SUB));
  expect(del.status).toBe(204);
  expect(await planUpdatedAt()).toBeGreaterThan(before);
});

describe("compare-and-set", () => {
  function patch(sub: string, kind: string, id: string, body: object) {
    return request(API_URL)
      .patch(`/plans/${planId}/items/${kind}/${id}`)
      .set(as(sub))
      .send(body);
  }

  async function planPlace(sub = ALICE_SUB): Promise<string> {
    const res = await add(sub, { kind: "place", id: await ownPlace(sub) });
    expect(res.status).toBe(201);
    return res.body.item.id;
  }

  // Mutation: compare without `from` (last write wins).
  it("saves a field whose from still matches, and refuses one that changed", async () => {
    const id = await planPlace();
    const saved = await patch(BOB_SUB, "place", id, {
      name: { from: "Test gully", to: "Test gully north" },
      position: {
        from: { latitude: -33.6, longitude: 150.3 },
        to: { latitude: -33.61, longitude: 150.31 },
      },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(403);
    await membership(BOB_ID, "editor");
    const ok = await patch(BOB_SUB, "place", id, {
      name: { from: "Test gully", to: "Test gully north" },
      position: {
        from: { latitude: -33.6, longitude: 150.3 },
        to: { latitude: -33.61, longitude: 150.31 },
      },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({
      kind: "place",
      name: "Test gully north",
      latitude: -33.61,
      longitude: 150.31,
    });

    // alice still saw the old name: nothing of hers saves, all or nothing.
    const stale = await patch(ALICE_SUB, "place", id, {
      name: { from: "Test gully", to: "Test gully south" },
      notes: { from: null, to: "Test notes" },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe(
      "Not saved: someone else changed this. Check their change, then save yours again.",
    );
    const row = await prisma.place.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ name: "Test gully north", notes: null });
  });

  // Mutation: read the row before touchPlan in underLock; both racing saves
  // then compare against the same old value and land.
  it("lets one of two saves from the same value land, and refuses the other", async () => {
    const id = await planPlace();
    const results = await Promise.all(
      ["Test gully east", "Test gully west", "Test gully south"].map((to) =>
        patch(ALICE_SUB, "place", id, { name: { from: "Test gully", to } }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    const winner = results.find((r) => r.status === 200)!;
    const row = await prisma.place.findUniqueOrThrow({ where: { id } });
    expect(row.name).toBe(winner.body.name);
  });

  // Mutation: requirePlanWrite → a plan-exists check in the PATCH.
  it("404s someone not in the plan and a removed member", async () => {
    const id = await planPlace(BOB_SUB);
    const body = { notes: { from: null, to: "Test notes" } };
    expect((await patch(CAROL_SUB, "place", id, body)).status).toBe(404);
    await prisma.tripPlanMember.delete({
      where: { planId_userId: { planId, userId: BOB_ID } },
    });
    expect((await patch(BOB_SUB, "place", id, body)).status).toBe(404);
    const row = await prisma.place.findUniqueOrThrow({ where: { id } });
    expect(row.notes).toBeNull();
  });

  // Mutation: compare fieldValues as a whole instead of per key.
  it("lets two members write different attributes, and refuses a stale one", async () => {
    const id = await planPlace();
    const first = await patch(ALICE_SUB, "place", id, {
      fieldValues: { v_grade: { from: null, to: 3 } },
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    // bob added nothing, so he edits through a role.
    await membership(BOB_ID, "editor");
    const second = await patch(BOB_SUB, "place", id, {
      fieldValues: { a_grade: { from: null, to: 2 } },
    });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.fieldValues).toEqual({ v_grade: 3, a_grade: 2 });

    const stale = await patch(BOB_SUB, "place", id, {
      fieldValues: { v_grade: { from: null, to: 4 } },
    });
    expect(stale.status).toBe(409);
    const cleared = await patch(ALICE_SUB, "place", id, {
      fieldValues: { v_grade: { from: 3, to: null } },
    });
    expect(cleared.body.fieldValues).toEqual({ a_grade: 2 });
  });

  it("checks `to` as the place form does, and refuses what a broken client sends", async () => {
    const id = await planPlace();
    const cases: [object, number][] = [
      [{ fieldValues: { v_grade: { from: null, to: 99 } } }, 400],
      [{ name: { from: "Test gully", to: " " } }, 400],
      [{ fieldValues: { not_a_key: { from: null, to: 1 } } }, 400],
      [
        {
          position: {
            from: { latitude: -33.6, longitude: 150.3 },
            to: { latitude: 200, longitude: 150 },
          },
        },
        400,
      ],
      [{ ownerId: { from: null, to: ALICE_ID } }, 400],
      [{ name: "Test gully" }, 400],
      [{}, 400],
      // A malformed `from` is the client's bug, not someone else's change.
      // Mutation: drop the from checks in parseTripPlanPlacePatch.
      [{ name: { from: 3, to: "Test gully north" } }, 400],
      [
        {
          position: {
            from: "x",
            to: { latitude: -33.61, longitude: 150.31 },
          },
        },
        400,
      ],
      [
        {
          altNames: {
            from: Array.from({ length: 51 }, () => "a"),
            to: [],
          },
        },
        413,
      ],
    ];
    for (const [body, status] of cases) {
      const res = await patch(ALICE_SUB, "place", id, body);
      expect(res.status, JSON.stringify(body)).toBe(status);
    }
    const row = await prisma.place.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ name: "Test gully", latitude: -33.6 });
  });

  it("edits a route's line with its anchors, and a file's name", async () => {
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
    const id = added.body.item.id;
    const from = {
      points: added.body.item.points,
      anchors: added.body.item.anchors,
    };
    const to = {
      points: [
        [150.3, -33.6],
        [150.305, -33.605],
        [150.31, -33.61],
      ],
      anchors: [0, 2],
    };
    const res = await patch(ALICE_SUB, "route", id, {
      geometry: { from, to },
      color: { from: added.body.item.color, to: added.body.item.color },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ points: to.points, anchors: [0, 2] });
    expect(
      (await patch(ALICE_SUB, "route", id, { geometry: { from, to } })).status,
    ).toBe(409);
    // Mutation: let geometry.to go without points in parseTripPlanRoutePatch.
    for (const [body, status] of [
      [{ geometry: { from: to, to: {} } }, 400],
      [{ geometry: { from: to, to: { anchors: null } } }, 400],
      [{ geometry: { from: 5, to } }, 400],
      [
        {
          geometry: {
            from: { points: Array(1001).fill([150.3, -33.6]), anchors: null },
            to,
          },
        },
        413,
      ],
    ] as const) {
      const refused = await patch(ALICE_SUB, "route", id, body);
      expect(refused.status, JSON.stringify(body).slice(0, 80)).toBe(status);
    }
    const stored = await prisma.route.findUniqueOrThrow({ where: { id } });
    expect(stored.points).toEqual(to.points);
    await request(API_URL)
      .delete(`/routes/${route.body.id}`)
      .set(as(ALICE_SUB));

    const fileId = await ownFile(ALICE_SUB);
    const file = await add(ALICE_SUB, { kind: "media", id: fileId });
    const renamed = await patch(ALICE_SUB, "media", file.body.item.id, {
      displayName: { from: null, to: "Test exit track" },
    });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect(renamed.body.item.displayName).toBe("Test exit track");
    await request(API_URL).delete(`/media/${fileId}`).set(as(ALICE_SUB));
  });

  // Mutation: drop touchPlan from the edit's transaction.
  it("moves the plan's updatedAt", async () => {
    const id = await planPlace();
    const before = await planUpdatedAt();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const res = await patch(ALICE_SUB, "place", id, {
      notes: { from: null, to: "Test notes" },
    });
    expect(res.status).toBe(200);
    expect(await planUpdatedAt()).toBeGreaterThan(before);
  });

  it("refuses on an archived plan and 404s an item that isn't in it", async () => {
    const id = await planPlace();
    expect(
      (
        await patch(ALICE_SUB, "place", SHARED_PLACE_ID, {
          notes: { from: null, to: "x" },
        })
      ).status,
    ).toBe(404);
    await prisma.tripPlan.update({
      where: { id: planId },
      data: { archivedAt: new Date() },
    });
    expect(
      (await patch(ALICE_SUB, "place", id, { notes: { from: null, to: "x" } }))
        .status,
    ).toBe(409);
  });
});

describe("storage when someone goes", () => {
  const SIZE = BigInt(GPX.length);

  /** A file of `sub`'s added to `plan`; returns the plan's copy's row id. */
  async function planFile(sub: string, plan = planId): Promise<string> {
    const fileId = await ownFile(sub);
    const res = await request(API_URL)
      .post(`/plans/${plan}/items`)
      .set(as(sub))
      .send({ kind: "media", id: fileId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await request(API_URL).delete(`/media/${fileId}`).set(as(sub));
    return res.body.item.id;
  }

  const exists = (key: string) =>
    s3
      .send(new HeadObjectCommand({ Bucket: MEDIA_BUCKET, Key: key }))
      .then(() => true)
      .catch(() => false);

  // DELETE /plans/:id/members/:userId: bob leaves, or alice removes him.
  async function leave(query = "") {
    const res = await request(API_URL)
      .delete(`/plans/${planId}/members/me${query}`)
      .set(as(BOB_SUB));
    expect(res.status, JSON.stringify(res.body)).toBe(204);
  }
  async function remove(query = "") {
    const res = await request(API_URL)
      .delete(`/plans/${planId}/members/${BOB_ID}${query}`)
      .set(as(ALICE_SUB));
    expect(res.status, JSON.stringify(res.body)).toBe(204);
  }

  /** A user no seed knows, signed in through fake auth's unknown-sub path. */
  async function throwaway() {
    const tag = randomUUID();
    return prisma.user.create({
      data: {
        cognitoId: `plan-items-${tag}`,
        username: `pi-${tag.slice(0, 8)}`,
        email: `pi-${tag}@example.invalid`,
      },
    });
  }

  it("leaves a leaver's files charged to them", async () => {
    const id = await planFile(BOB_SUB);
    const [bob, alice] = [await used(BOB_ID), await used(ALICE_ID)];
    // Mutation: a leave passes the plan's leader as removedBy in
    // planMembers.ts (the leaver's files then move to alice).
    await leave();
    expect(await used(BOB_ID)).toBe(bob);
    expect(await used(ALICE_ID)).toBe(alice);
    const row = await prisma.media.findUniqueOrThrow({ where: { id } });
    expect(row.chargedToId).toBe(BOB_ID);
  });

  it("moves a removed member's files to the leader removing them", async () => {
    const id = await planFile(BOB_SUB);
    const [bob, alice] = [await used(BOB_ID), await used(ALICE_ID)];
    // Mutation: drop moveCharges from memberGone.
    await remove();
    expect(await used(BOB_ID)).toBe(bob - SIZE);
    expect(await used(ALICE_ID)).toBe(alice + SIZE);
    const row = await prisma.media.findUniqueOrThrow({ where: { id } });
    expect(row.chargedToId).toBe(ALICE_ID);
  });

  // Mutation: refuse the move in moveCharges when it takes alice past quota.
  it("takes on the files past the leader's quota", async () => {
    const id = await planFile(BOB_SUB);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: ALICE_ID },
    });
    await prisma.user.update({
      where: { id: ALICE_ID },
      data: { storageQuotaBytes: user.storageUsedBytes },
    });
    try {
      await remove();
      const row = await prisma.media.findUniqueOrThrow({ where: { id } });
      expect(row.chargedToId).toBe(ALICE_ID);
      expect(await used(ALICE_ID)).toBe(user.storageUsedBytes + SIZE);
    } finally {
      await prisma.user.update({
        where: { id: ALICE_ID },
        data: { storageQuotaBytes: user.storageQuotaBytes },
      });
    }
  });

  it("deletes a removed member's files instead with deleteFiles", async () => {
    const id = await planFile(BOB_SUB);
    const row = await prisma.media.findUniqueOrThrow({ where: { id } });
    const [bob, alice] = [await used(BOB_ID), await used(ALICE_ID)];
    // Mutation: ignore deleteFiles (they move to alice instead).
    await remove("?deleteFiles=true");
    expect(await prisma.media.findUnique({ where: { id } })).toBeNull();
    expect(await exists(row.s3KeyDisplay)).toBe(false);
    expect(await used(BOB_ID)).toBe(bob - SIZE);
    expect(await used(ALICE_ID)).toBe(alice);
  });

  it("deletes what a leaver added with deleteAdded, and nothing else", async () => {
    const id = await planFile(BOB_SUB);
    const source = await ownPlace(BOB_SUB);
    const place = await add(BOB_SUB, { kind: "place", id: source });
    expect(place.status).toBe(201);
    const alices = await planFile(ALICE_SUB);
    const before = await used(BOB_ID);
    // Mutation: drop the place deleteMany from memberGone.
    await leave("?deleteAdded=true");
    expect(await prisma.media.findUnique({ where: { id } })).toBeNull();
    expect(
      await prisma.place.findUnique({ where: { id: place.body.item.id } }),
    ).toBeNull();
    expect(await prisma.media.findUnique({ where: { id: alices } })).not.toBe(
      null,
    );
    expect(await used(BOB_ID)).toBe(before - SIZE);
    await request(API_URL).delete(`/places/${source}`).set(as(BOB_SUB));
  });

  it("moves an account's charges to the plan's creator, keeping the file", async () => {
    const dave = await throwaway();
    try {
      await membership(dave.id);
      const id = await planFile(dave.cognitoId);
      const before = await used(ALICE_ID);
      const del = await request(API_URL)
        .delete("/users/me")
        .set(as(dave.cognitoId));
      expect(del.status).toBe(204);
      // Mutation: drop handOverPlans from DELETE /users/me (the charge
      // falls to SetNull and no one pays).
      const row = await prisma.media.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({
        planId,
        chargedToId: ALICE_ID,
        addedById: null,
      });
      expect(await exists(row.s3KeyDisplay)).toBe(true);
      expect(await used(ALICE_ID)).toBe(before + SIZE);
    } finally {
      await prisma.user.deleteMany({ where: { id: dave.id } });
    }
  });

  // Mutation: heir = leader.userId in handOverPlans.
  it("moves an account's charges to the creator when someone else leads", async () => {
    const dave = await throwaway();
    try {
      await membership(dave.id);
      await membership(BOB_ID, "leader");
      await membership(ALICE_ID, "member");
      const id = await planFile(dave.cognitoId);
      const [alice, bob] = [await used(ALICE_ID), await used(BOB_ID)];
      const del = await request(API_URL)
        .delete("/users/me")
        .set(as(dave.cognitoId));
      expect(del.status).toBe(204);
      const row = await prisma.media.findUniqueOrThrow({ where: { id } });
      expect(row.chargedToId).toBe(ALICE_ID);
      expect(await used(ALICE_ID)).toBe(alice + SIZE);
      expect(await used(BOB_ID)).toBe(bob);
    } finally {
      await membership(ALICE_ID, "leader");
      await prisma.user.deleteMany({ where: { id: dave.id } });
    }
  });

  // Called straight, as the account route does before its own transaction:
  // between the two, each hand-over must already have taken its user out of
  // the plan, or the second still sees the first as leader and creator.
  // Mutation: drop dropMembership from handOverPlans.
  it("leaves a leader and a payer when two hand-overs run back to back", async () => {
    const [dave, erin] = [await throwaway(), await throwaway()];
    let plan: string | undefined;
    try {
      const res = await request(API_URL)
        .post("/plans")
        .set(as(dave.cognitoId))
        .send({ name: "Test two departures" });
      expect(res.status).toBe(201);
      plan = res.body.id as string;
      for (const userId of [erin.id, BOB_ID])
        await prisma.tripPlanMember.create({
          data: { planId: plan, userId, status: "active", role: "member" },
        });
      const files = [
        await planFile(dave.cognitoId, plan),
        await planFile(erin.cognitoId, plan),
      ];
      const before = await used(BOB_ID);
      await handOverPlans(dave.id);
      await handOverPlans(erin.id);
      const left = await prisma.tripPlanMember.findMany({
        where: { planId: plan },
        select: { userId: true, role: true },
      });
      expect(left).toEqual([{ userId: BOB_ID, role: "leader" }]);
      const rows = await prisma.media.findMany({
        where: { id: { in: files } },
      });
      expect(rows.map((row) => row.chargedToId)).toEqual([BOB_ID, BOB_ID]);
      expect(await used(BOB_ID)).toBe(before + 2n * SIZE);
    } finally {
      await prisma.user.deleteMany({
        where: { id: { in: [dave.id, erin.id] } },
      });
      if (plan)
        await request(API_URL).delete(`/plans/${plan}`).set(as(BOB_SUB));
    }
  });

  // Called straight for carol, who isn't in the plan: what an add in flight
  // meets when a leave, remove or hand-over commits during its S3 copy.
  // Mutation: drop requireStillMember from chargeAndWrite.
  it("charges no one who left during the copy", async () => {
    const fileId = await ownFile(CAROL_SUB);
    const source = await prisma.media.findUniqueOrThrow({
      where: { id: fileId },
    });
    const before = await used(CAROL_ID);
    try {
      await expect(
        copyStandaloneFile(source, CAROL_ID, { planId }),
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(await prisma.media.count({ where: { planId } })).toBe(0);
      expect(await used(CAROL_ID)).toBe(before);
    } finally {
      await request(API_URL).delete(`/media/${fileId}`).set(as(CAROL_SUB));
    }
  });

  it("makes the earliest member leader when the last leader's account goes, and deletes a plan left empty", async () => {
    const dave = await throwaway();
    const plans: string[] = [];
    try {
      for (const name of ["Test kept plan", "Test empty plan"]) {
        const res = await request(API_URL)
          .post("/plans")
          .set(as(dave.cognitoId))
          .send({ name });
        expect(res.status).toBe(201);
        plans.push(res.body.id);
      }
      const [kept, empty] = plans;
      for (const userId of [BOB_ID, CAROL_ID])
        await prisma.tripPlanMember.create({
          data: { planId: kept, userId, status: "active", role: "member" },
        });
      await prisma.tripPlanMember.create({
        data: {
          planId: empty,
          userId: CAROL_ID,
          status: "invited",
          role: "member",
          invitedById: dave.id,
        },
      });
      const keptFile = await planFile(dave.cognitoId, kept);
      const emptyFile = await planFile(dave.cognitoId, empty);
      const emptyKey = (
        await prisma.media.findUniqueOrThrow({ where: { id: emptyFile } })
      ).s3KeyDisplay;
      const before = await used(BOB_ID);

      const del = await request(API_URL)
        .delete("/users/me")
        .set(as(dave.cognitoId));
      expect(del.status).toBe(204);

      // Mutation: drop the promotion in handOverPlans.
      const roles = await prisma.tripPlanMember.findMany({
        where: { planId: kept },
        select: { userId: true, role: true },
      });
      expect(roles).toEqual(
        expect.arrayContaining([
          { userId: BOB_ID, role: "leader" },
          { userId: CAROL_ID, role: "member" },
        ]),
      );
      // The creator is gone, so the new leader pays.
      const row = await prisma.media.findUniqueOrThrow({
        where: { id: keptFile },
      });
      expect(row.chargedToId).toBe(BOB_ID);
      expect(await used(BOB_ID)).toBe(before + SIZE);
      // Mutation: skip the delete for a plan with no one left.
      expect(await prisma.tripPlan.findUnique({ where: { id: empty } })).toBe(
        null,
      );
      expect(await exists(emptyKey)).toBe(false);
      // Mutation: drop endPlanForOthers from handOverPlans' delete; carol,
      // invited, would find the plan gone from her list unexplained.
      const notice = await prisma.notification.findFirst({
        where: {
          userId: CAROL_ID,
          type: "plan_access_ended",
          payload: { path: ["planId"], equals: empty },
        },
      });
      expect(notice?.payload).toMatchObject({ reason: "deleted" });
      await prisma.notification.deleteMany({ where: { id: notice?.id } });
    } finally {
      await prisma.user.deleteMany({ where: { id: dave.id } });
      if (plans[0])
        await request(API_URL).delete(`/plans/${plans[0]}`).set(as(BOB_SUB));
    }
  });
});
