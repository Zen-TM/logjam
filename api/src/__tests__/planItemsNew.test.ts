import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { s3 } from "../services/awsClients";
import { createPlanFile } from "../lib/planItems";
import { randomUUID } from "crypto";
import prisma from "../services/prisma";
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
  as,
} from "./_actors";

// A place or way made straight in a plan, owned by no account. Split from
// planItems.test.ts, which spends its rate-limit budget on copies. alice
// leads the plan; bob is an active member; carol is not in it.
//
// Requires `make dev` (Postgres + MiniStack + API). Every plan and row here
// is the test's own; the sweep removes them.

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

beforeEach(async () => {
  const res = await request(API_URL)
    .post("/plans")
    .set(as(ALICE_SUB))
    .send({ name: "Test new items plan" });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  planId = res.body.id;
  await membership(BOB_ID);
});

afterEach(async () => {
  await request(API_URL).delete(`/plans/${planId}`).set(as(ALICE_SUB));
});

describe("POST /plans/:id/items (a new place or way, made in the plan)", () => {
  const newPlace = (extra: object = {}) => ({
    placeTypeId: MARKER_TYPE_ID,
    name: "Test water drop",
    latitude: -33.7,
    longitude: 150.2,
    ...extra,
  });
  const newRoute = (extra: object = {}) => ({
    name: "Test walk-out",
    points: [
      [150.3, -33.6],
      [150.31, -33.61],
      [150.32, -33.62],
    ],
    ...extra,
  });
  const planRows = async () => ({
    places: await prisma.place.count({ where: { planId } }),
    routes: await prisma.route.count({ where: { planId } }),
  });

  it("makes a place in the plan that no account holds, charged to no one", async () => {
    const before = await planUpdatedAt();
    const storage = await used(BOB_ID);
    const ownBefore = await prisma.place.count({ where: { ownerId: BOB_ID } });
    const res = await add(BOB_SUB, {
      kind: "place",
      new: newPlace({
        altNames: ["Test tank"],
        elevation: 410,
        notes: "Test notes",
      }),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.item).toMatchObject({
      kind: "place",
      name: "Test water drop",
      altNames: ["Test tank"],
      latitude: -33.7,
      longitude: 150.2,
      elevation: 410,
      notes: "Test notes",
      placeTypeId: MARKER_TYPE_ID,
      addedBy: { id: BOB_ID, username: "bob" },
      media: [],
    });
    // Mutation: set ownerId on the new place.
    const row = await prisma.place.findUniqueOrThrow({
      where: { id: res.body.item.id },
    });
    expect(row).toMatchObject({ ownerId: null, planId, addedById: BOB_ID });
    expect(await prisma.place.count({ where: { ownerId: BOB_ID } })).toBe(
      ownBefore,
    );
    expect(await used(BOB_ID)).toBe(storage);
    // Mutation: drop touchPlanAsMember from createPlanPlace.
    expect(await planUpdatedAt()).toBeGreaterThan(before);

    const view = await request(API_URL)
      .get(`/plans/${planId}`)
      .set(as(ALICE_SUB));
    expect(view.body.places.map((p: { id: string }) => p.id)).toEqual([
      res.body.item.id,
    ]);
  });

  it("holds a canyon's attributes as a copied plan place does", async () => {
    const res = await add(ALICE_SUB, {
      kind: "place",
      new: newPlace({
        placeTypeId: CANYON_TYPE_ID,
        fieldValues: { v_grade: 3, a_grade: null },
      }),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.item.fieldValues).toEqual({ v_grade: 3 });
  });

  it("makes a way in the plan, unlinked and in a colour the plan lacks", async () => {
    const first = await add(ALICE_SUB, { kind: "route", new: newRoute() });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.item).toMatchObject({
      kind: "route",
      name: "Test walk-out",
      placeId: null,
      anchors: null,
      addedBy: { id: ALICE_ID },
    });
    const second = await add(BOB_SUB, {
      kind: "route",
      new: newRoute({ name: " Test second ", anchors: [0, 2] }),
    });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(second.body.item).toMatchObject({
      name: "Test second",
      anchors: [0, 2],
    });
    // Mutation: pick the colour from the adder's account rather than the plan.
    expect(second.body.item.color).not.toBe(first.body.item.color);
    const chosen = await add(BOB_SUB, {
      kind: "route",
      new: newRoute({ color: first.body.item.color }),
    });
    expect(chosen.body.item.color).toBe(first.body.item.color);
    const row = await prisma.route.findUniqueOrThrow({
      where: { id: first.body.item.id },
    });
    expect(row).toMatchObject({ ownerId: null, planId, placeId: null });
  });

  // The boundary: who may write into a plan. Mutation: requirePlanWrite → a
  // plan-exists check in the POST and touchPlanAsMember → touchPlan in
  // createPlanPlace and createPlanRoute; either alone is caught by the other.
  // Mutation: drop the archivedAt throw from requirePlanWrite and from
  // touchPlanAsMember (both: each alone is caught by the other).
  it("writes nothing for someone not in the plan, invited, or removed", async () => {
    const bodies = [
      { kind: "place", new: newPlace() },
      { kind: "route", new: newRoute() },
    ];
    for (const body of bodies) {
      const stranger = await add(CAROL_SUB, body);
      expect(stranger.status, body.kind).toBe(404);
      expect(stranger.body.error).toBe("Couldn't find that plan.");
    }
    for (const status of ["invited", "requested"]) {
      await prisma.tripPlanMember.upsert({
        where: { planId_userId: { planId, userId: CAROL_ID } },
        create: {
          planId,
          userId: CAROL_ID,
          status,
          role: "member",
          invitedById: ALICE_ID,
        },
        update: { status },
      });
      for (const body of bodies)
        expect((await add(CAROL_SUB, body)).status, status).toBe(404);
    }
    await prisma.tripPlanMember.delete({
      where: { planId_userId: { planId, userId: BOB_ID } },
    });
    for (const body of bodies)
      expect((await add(BOB_SUB, body)).status, "removed").toBe(404);
    expect(await planRows()).toEqual({ places: 0, routes: 0 });
  });

  // Mutation: requirePlanWrite → a plan-exists check in the POST and
  // touchPlanAsMember → touchPlan in createPlanPlace (both: each alone is
  // caught by the other).
  it("refuses a write to an archived plan, leader or not", async () => {
    await prisma.tripPlan.update({
      where: { id: planId },
      data: { archivedAt: new Date() },
    });
    for (const sub of [ALICE_SUB, BOB_SUB]) {
      expect((await add(sub, { kind: "place", new: newPlace() })).status).toBe(
        409,
      );
      expect((await add(sub, { kind: "route", new: newRoute() })).status).toBe(
        409,
      );
    }
    expect(await planRows()).toEqual({ places: 0, routes: 0 });
  });

  it("can't make an item in a plan its caller isn't in, however it is named", async () => {
    const other = await request(API_URL)
      .post("/plans")
      .set(as(CAROL_SUB))
      .send({ name: "Test other plan" });
    expect(other.status).toBe(201);
    try {
      // bob is in alice's plan, not carol's.
      const res = await request(API_URL)
        .post(`/plans/${other.body.id}/items`)
        .set(as(BOB_SUB))
        .send({ kind: "place", new: newPlace() });
      expect(res.status).toBe(404);
      expect(
        await prisma.place.count({ where: { planId: other.body.id } }),
      ).toBe(0);
    } finally {
      await request(API_URL)
        .delete(`/plans/${other.body.id}`)
        .set(as(CAROL_SUB));
    }
  });

  // Mutation: skip refuseNewItem, or the system-type check in it.
  it("refuses what the place and way forms refuse, writing nothing", async () => {
    const ownType = await prisma.placeType.create({
      data: {
        ownerId: ALICE_ID,
        name: "Test own type",
        iconKey: "marker",
        color: "#4BB4D9",
      },
    });
    const long = "x".repeat(201);
    const cases: [object, number][] = [
      [{ kind: "place", new: newPlace({ name: " " }) }, 400],
      [{ kind: "place", new: newPlace({ name: long }) }, 400],
      [{ kind: "place", new: newPlace({ latitude: 200 }) }, 400],
      [{ kind: "place", new: newPlace({ longitude: "x" }) }, 400],
      [{ kind: "place", new: newPlace({ placeTypeId: ownType.id }) }, 400],
      [{ kind: "place", new: newPlace({ placeTypeId: randomUUID() }) }, 400],
      [{ kind: "place", new: newPlace({ placeTypeId: undefined }) }, 400],
      [{ kind: "place", new: newPlace({ notes: 4 }) }, 400],
      [{ kind: "place", new: newPlace({ ownerId: ALICE_ID }) }, 400],
      [{ kind: "place", new: newPlace({ addedById: BOB_ID }) }, 400],
      [{ kind: "place", new: newPlace({ planId: randomUUID() }) }, 400],
      [
        { kind: "place", new: newPlace({ fieldValues: { not_a_key: 1 } }) },
        400,
      ],
      [
        {
          kind: "place",
          new: newPlace({
            placeTypeId: CANYON_TYPE_ID,
            fieldValues: { v_grade: 99 },
          }),
        },
        400,
      ],
      [
        {
          kind: "place",
          new: newPlace({ altNames: Array.from({ length: 51 }, () => "a") }),
        },
        413,
      ],
      [{ kind: "place", new: [] }, 400],
      [{ kind: "route", new: newRoute({ name: " " }) }, 400],
      [{ kind: "route", new: newRoute({ color: "chartreuse" }) }, 400],
      [{ kind: "route", new: newRoute({ points: [[150.3, -33.6]] }) }, 400],
      [
        {
          kind: "route",
          new: newRoute({
            points: [
              [150.3, -33.6],
              [500, -33.6],
            ],
          }),
        },
        400,
      ],
      [{ kind: "route", new: newRoute({ anchors: [0, 9] }) }, 400],
      [
        {
          kind: "route",
          new: newRoute({
            points: Array.from({ length: 1001 }, () => [150.3, -33.6]),
          }),
        },
        413,
      ],
      [{ kind: "route", new: newRoute({ placeId: randomUUID() }) }, 400],
      [{ kind: "route", new: newRoute({ ownerId: ALICE_ID }) }, 400],
      [{ kind: "media", new: {} }, 400],
      [{ kind: "place", id: randomUUID(), new: newPlace() }, 400],
    ];
    try {
      for (const [body, status] of cases) {
        const res = await add(ALICE_SUB, body);
        expect(res.status, JSON.stringify(body)).toBe(status);
      }
    } finally {
      await prisma.placeType.delete({ where: { id: ownType.id } });
    }
    expect(await planRows()).toEqual({ places: 0, routes: 0 });
    expect(await prisma.media.count({ where: { planId } })).toBe(0);
  });

  // Mutation: set addedById to null on either create.
  it("lets its maker edit and delete it, refuses another member, and lets any member save a copy", async () => {
    await membership(CAROL_ID);
    const place = (
      await add(BOB_SUB, { kind: "place", new: newPlace({ notes: "Test" }) })
    ).body.item;
    const route = (await add(BOB_SUB, { kind: "route", new: newRoute() })).body
      .item;

    const edit = (sub: string, kind: string, id: string, body: object) =>
      request(API_URL)
        .patch(`/plans/${planId}/items/${kind}/${id}`)
        .set(as(sub))
        .send(body);
    const del = (sub: string, kind: string, id: string) =>
      request(API_URL)
        .delete(`/plans/${planId}/items/${kind}/${id}`)
        .set(as(sub));

    const renamed = await edit(BOB_SUB, "place", place.id, {
      name: { from: "Test water drop", to: "Test water drop 2" },
    });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect(renamed.body.name).toBe("Test water drop 2");
    const redrawn = await edit(BOB_SUB, "route", route.id, {
      name: { from: "Test walk-out", to: "Test walk-out 2" },
    });
    expect(redrawn.status, JSON.stringify(redrawn.body)).toBe(200);

    // carol is a plain member who did not make them.
    expect(
      (
        await edit(CAROL_SUB, "place", place.id, {
          name: { from: "Test water drop 2", to: "Test mine" },
        })
      ).status,
    ).toBe(403);
    expect((await del(CAROL_SUB, "place", place.id)).status).toBe(403);
    expect((await del(CAROL_SUB, "route", route.id)).status).toBe(403);

    // Save a copy is every member's, the maker's or not.
    const copies = await prisma.place.count({ where: { ownerId: CAROL_ID } });
    const savedPlace = await request(API_URL)
      .post(`/plans/${planId}/items/place/${place.id}/save`)
      .set(as(CAROL_SUB))
      .send({});
    expect(savedPlace.status, JSON.stringify(savedPlace.body)).toBe(201);
    expect(savedPlace.body).toMatchObject({
      ownerId: CAROL_ID,
      name: "Test water drop 2",
      latitude: -33.7,
    });
    expect(await prisma.place.count({ where: { ownerId: CAROL_ID } })).toBe(
      copies + 1,
    );
    const savedRoute = await request(API_URL)
      .post(`/plans/${planId}/items/route/${route.id}/save`)
      .set(as(CAROL_SUB))
      .send({});
    expect(savedRoute.status, JSON.stringify(savedRoute.body)).toBe(201);
    expect(savedRoute.body).toMatchObject({
      ownerId: CAROL_ID,
      name: "Test walk-out 2",
      placeId: null,
    });
    await request(API_URL)
      .delete(`/places/${savedPlace.body.id}`)
      .set(as(CAROL_SUB));
    await request(API_URL)
      .delete(`/routes/${savedRoute.body.id}`)
      .set(as(CAROL_SUB));

    expect((await del(BOB_SUB, "place", place.id)).status).toBe(204);
    expect((await del(BOB_SUB, "route", route.id)).status).toBe(204);
    expect(await planRows()).toEqual({ places: 0, routes: 0 });
  });
});

describe("a way imported straight into the plan", () => {
  const GPX = Buffer.from(
    `<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><trkseg>
  <trkpt lat="-33.5" lon="150.4"/><trkpt lat="-33.51" lon="150.41"/>
</trkseg></trk></gpx>`,
    "utf8",
  );
  const meta = {
    filename: `plan-test-${Date.now()}.gpx`,
    mediaType: "application/gpx+xml",
    displayName: "Test walk-out",
    metadata: {
      bbox: [150.4, -33.51, 150.41, -33.5],
      featureCount: 1,
      positionCount: 2,
    },
  };
  const presign = (sub: string, body: object = {}) =>
    request(API_URL)
      .post(`/plans/${planId}/items/media/presign`)
      .set(as(sub))
      .send({ ...meta, sizeBytes: GPX.length, ...body });
  const confirm = (sub: string, mediaId: string, body: object = {}) =>
    request(API_URL)
      .post(`/plans/${planId}/items/media/${mediaId}/confirm`)
      .set(as(sub))
      .send({ ...meta, ...body });
  async function upload(sub: string) {
    const signed = await presign(sub);
    expect(signed.status, JSON.stringify(signed.body)).toBe(201);
    const put = await fetch(signed.body.displayUploadUrl, {
      method: "PUT",
      headers: { "Content-Type": meta.mediaType },
      body: GPX,
    });
    expect(put.ok).toBe(true);
    return signed.body.mediaId as string;
  }

  // Mutation: charge the plan's creator, or no one, instead of the adder.
  it("keeps the file in the plan, charged to the one who imported it", async () => {
    const before = await used(BOB_ID);
    const mediaId = await upload(BOB_SUB);
    const res = await confirm(BOB_SUB, mediaId);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.item).toMatchObject({
      kind: "media",
      id: mediaId,
      sizeBytes: String(GPX.length),
      addedBy: { id: BOB_ID },
      chargedTo: { id: BOB_ID },
    });
    const row = await prisma.media.findUniqueOrThrow({
      where: { id: mediaId },
    });
    expect(row).toMatchObject({
      ownerId: null,
      planId,
      linkedType: "none",
      origin: "import",
    });
    expect(await used(BOB_ID)).toBe(before + BigInt(GPX.length));

    // A retried confirm answers with the row and charges nothing more.
    const again = await confirm(BOB_SUB, mediaId);
    expect(again.status).toBe(200);
    expect(await used(BOB_ID)).toBe(before + BigInt(GPX.length));
    expect((await confirm(ALICE_SUB, mediaId)).status).toBe(404);

    // Any member saves a copy; its maker's delete refunds them.
    const saved = await request(API_URL)
      .post(`/plans/${planId}/items/media/${mediaId}/save`)
      .set(as(ALICE_SUB))
      .send({});
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    await request(API_URL).delete(`/media/${saved.body.id}`).set(as(ALICE_SUB));
    const del = await request(API_URL)
      .delete(`/plans/${planId}/items/media/${mediaId}`)
      .set(as(BOB_SUB));
    expect(del.status).toBe(204);
    expect(await used(BOB_ID)).toBe(before);
  });

  // Mutation: remove the kept-row check in chargeAndWrite, and the loser
  // deletes the object the winner's row points at.
  it("keeps the file when two confirms of one upload race", async () => {
    const before = await used(BOB_ID);
    const mediaId = await upload(BOB_SUB);
    const [one, two] = await Promise.all([
      confirm(BOB_SUB, mediaId),
      confirm(BOB_SUB, mediaId),
    ]);
    expect([one.status, two.status].sort()).toEqual([200, 201]);
    expect(one.body.item.id).toBe(mediaId);
    expect(two.body.item.id).toBe(mediaId);
    const row = await prisma.media.findUniqueOrThrow({
      where: { id: mediaId },
    });
    await expect(
      s3.send(
        new HeadObjectCommand({
          Bucket: process.env.S3_BUCKET_MEDIA ?? "",
          Key: row.s3KeyDisplay,
        }),
      ),
    ).resolves.toBeTruthy();
    expect(await used(BOB_ID)).toBe(before + BigInt(GPX.length));
  });

  // Mutation: decide the delete in chargeAndWrite by the P2002 code alone
  // (not by whether a row holds the keys), and a loser stopped by the quota
  // deletes the winner's object.
  it("keeps the winner's file when the losing confirm fails its quota check", async () => {
    const mediaId = await upload(BOB_SUB);
    expect((await confirm(BOB_SUB, mediaId)).status).toBe(201);
    const row = await prisma.media.findUniqueOrThrow({
      where: { id: mediaId },
    });
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: BOB_ID },
      select: { storageUsedBytes: true, storageQuotaBytes: true },
    });
    // No room for the winner's bytes again: the loser's charge goes over.
    await prisma.user.update({
      where: { id: BOB_ID },
      data: { storageQuotaBytes: user.storageUsedBytes },
    });
    try {
      await expect(
        createPlanFile({ id: BOB_ID }, planId, {
          mediaId,
          bytes: BigInt(GPX.length),
          mediaType: meta.mediaType,
          filename: meta.filename,
          displayName: null,
          metadata: meta.metadata,
          color: null,
        }),
      ).rejects.toMatchObject({ statusCode: 507 });
    } finally {
      await prisma.user.update({
        where: { id: BOB_ID },
        data: { storageQuotaBytes: user.storageQuotaBytes },
      });
    }
    await expect(
      s3.send(
        new HeadObjectCommand({
          Bucket: process.env.S3_BUCKET_MEDIA ?? "",
          Key: row.s3KeyDisplay,
        }),
      ),
    ).resolves.toBeTruthy();
    expect(await prisma.media.count({ where: { planId } })).toBe(1);
  });

  // The boundary again, for a file: who may write into a plan.
  // Mutation: requirePlanWrite → requirePlanMember in the presign route (the
  // confirm's archived check is touchPlanAsMember's, in createPlanFile).
  // Mutation: read body.sizeBytes unchecked in the presign route (drop
  // validateUploadSizes), or drop the "never uploaded" 400 from uploadedSize.
  it("takes nothing from someone not in the plan, or into an archived one", async () => {
    expect((await presign(CAROL_SUB)).status).toBe(404);
    const mediaId = await upload(BOB_SUB);
    expect((await confirm(CAROL_SUB, mediaId)).status).toBe(404);
    await prisma.tripPlan.update({
      where: { id: planId },
      data: { archivedAt: new Date() },
    });
    expect((await presign(BOB_SUB)).status).toBe(409);
    expect((await confirm(BOB_SUB, mediaId)).status).toBe(409);
    expect(await prisma.media.count({ where: { planId } })).toBe(0);
  });

  it("refuses what the import never sends, and an upload that never landed", async () => {
    const cases: object[] = [
      { mediaType: "image/png", filename: "a.png" },
      { filename: "a.kml" },
      { metadata: { bbox: "x" } },
      { sizeBytes: 0 },
      { sizeBytes: 500 * 1024 * 1024 },
    ];
    for (const body of cases)
      expect(
        (await presign(BOB_SUB, body)).status,
        JSON.stringify(body),
      ).toBeGreaterThanOrEqual(400);
    const never = await confirm(BOB_SUB, randomUUID());
    expect(never.status).toBe(400);
    expect(await prisma.media.count({ where: { planId } })).toBe(0);
  });
});
