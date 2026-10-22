import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import prisma from "../services/prisma";
import {
  API_URL,
  ALICE_ID,
  ALICE_SUB,
  BOB_ID,
  BOB_SUB,
  CAROL_SUB,
  SHARED_PLACE_ID,
  MARKER_TYPE_ID,
  PLAN_PLACE_ID,
  PLAN_ROUTE_ID,
  SEED_PLAN_ID,
  as,
} from "./_actors";

// A plan-owned row (Plans) has planId set and no owner. Until plan
// access lands it is nobody's: it never appears in an owner's lists or
// /sync, cannot be shared or sent, and every by-id path 404s for everyone,
// the plan's own leader and members included.
//
// Requires `make dev`. Seed baseline: alice leads the seeded plan, bob is a
// member, carol asked to join and waits. Synthetic coords only.

const CLIENT = { "x-logjam-client": "mobile/0.1.0-test" } as const;
const EVERYONE = [ALICE_SUB, BOB_SUB, CAROL_SUB];

let planMediaId: string;
let planGeoPdfId: string;

/** A plan-owned file and GeoPDF on the seeded plan; the sweep removes them. */
beforeAll(async () => {
  planMediaId = (
    await prisma.media.create({
      data: {
        planId: SEED_PLAN_ID,
        addedById: ALICE_ID,
        chargedToId: ALICE_ID,
        linkedType: "none",
        s3KeyDisplay: `plan-test/${randomUUID()}.gpx`,
        mediaType: "application/gpx+xml",
        filename: "plan-walk.gpx",
        fileSizeBytes: 100n,
        origin: "import",
      },
    })
  ).id;
  planGeoPdfId = (
    await prisma.geoPdfJob.create({
      data: {
        planId: SEED_PLAN_ID,
        addedById: ALICE_ID,
        chargedToId: ALICE_ID,
        config: {},
        vectorStyleSnapshot: {},
        status: "completed",
        completedAt: new Date(),
      },
    })
  ).id;
});

const planIds = () => [PLAN_PLACE_ID, PLAN_ROUTE_ID, planMediaId, planGeoPdfId];

function expectNoPlanRows(body: unknown) {
  const text = JSON.stringify(body);
  for (const id of planIds()) expect(text).not.toContain(id);
}

describe("the one-owner CHECK", () => {
  // Mutation: drop any of the four *_one_owner constraints in
  // 20261019120000_trip_plans.
  const point = {
    placeTypeId: MARKER_TYPE_ID,
    name: "check-test",
    latitude: -33.5,
    longitude: 150.3,
  };
  const line = {
    name: "check-test",
    color: "#000000",
    points: [
      [150.3, -33.5],
      [150.31, -33.51],
    ],
  };
  const file = {
    linkedType: "none",
    s3KeyDisplay: "check-test",
    mediaType: "application/gpx+xml",
    filename: "check.gpx",
    fileSizeBytes: 1n,
  };
  const job = { config: {}, vectorStyleSnapshot: {} };

  it.each([
    [
      "place",
      () =>
        prisma.place.create({
          data: { ...point, ownerId: ALICE_ID, planId: SEED_PLAN_ID },
        }),
    ],
    ["place", () => prisma.place.create({ data: point })],
    [
      "route",
      () =>
        prisma.route.create({
          data: { ...line, ownerId: ALICE_ID, planId: SEED_PLAN_ID },
        }),
    ],
    ["route", () => prisma.route.create({ data: line })],
    [
      "media",
      () =>
        prisma.media.create({
          data: { ...file, ownerId: ALICE_ID, planId: SEED_PLAN_ID },
        }),
    ],
    ["media", () => prisma.media.create({ data: file })],
    [
      "geoPdfJob",
      () =>
        prisma.geoPdfJob.create({
          data: { ...job, userId: ALICE_ID, planId: SEED_PLAN_ID },
        }),
    ],
    ["geoPdfJob", () => prisma.geoPdfJob.create({ data: job })],
  ])("refuses a %s with both owners or neither", async (_kind, insert) => {
    await expect(insert()).rejects.toThrow(/one_owner/);
  });
});

describe("plan rows stay out of every owner-scoped list", () => {
  // Mutation: add `OR: [{ planId: { not: null } }]` to any of these lists'
  // where clauses.
  it.each([
    "/places",
    "/places/shared",
    "/places/tracks",
    "/routes",
    "/media/standalone",
    "/geo-pdf",
  ])("GET %s", async (path) => {
    for (const sub of EVERYONE) {
      const res = await request(API_URL).get(path).set(as(sub));
      expect(res.status).toBe(200);
      expectNoPlanRows(res.body);
    }
  });

  // Mutation: drop the null-owner filter in POST /media/download-urls.
  it("POST /media/download-urls, even for a file on a place shared with the caller", async () => {
    // Local to this test: a plan file linked to an owned place is not
    // something any route makes, and /sync would serve it to the place's
    // sharees.
    const linked = await prisma.media.create({
      data: {
        planId: SEED_PLAN_ID,
        linkedType: "place",
        linkedId: SHARED_PLACE_ID,
        s3KeyDisplay: `plan-test/${randomUUID()}.jpg`,
        mediaType: "image/jpeg",
        filename: "plan-photo.jpg",
        fileSizeBytes: 100n,
      },
    });
    try {
      for (const sub of EVERYONE) {
        const res = await request(API_URL)
          .post("/media/download-urls")
          .set(as(sub))
          .send({ ids: [planMediaId, linked.id] });
        expect(res.status).toBe(200);
        expect(res.body.items).toEqual([]);
      }
    } finally {
      await prisma.media.delete({ where: { id: linked.id } });
    }
  });

  it("a full /sync/delta pull", async () => {
    for (const sub of EVERYONE) {
      let cursor = "";
      for (let page = 0; page < 500; page++) {
        const res = await request(API_URL)
          .get("/sync/delta")
          .query({ cursor })
          .set(as(sub))
          .set(CLIENT);
        expect(res.status).toBe(200);
        expectNoPlanRows(res.body.changes);
        cursor = res.body.cursor;
        if (!res.body.hasMore) break;
      }
    }
  });
});

describe("plan rows cannot be shared or sent", () => {
  // Mutation: in lib/placeAccess.ts or lib/shareAccess.ts, treat a null
  // owner as matching (e.g. `if (!place.ownerId) return "owner"`).
  it("place share, item share and send 404", async () => {
    for (const sub of [ALICE_SUB, BOB_SUB]) {
      const placeShare = await request(API_URL)
        .post(`/places/${PLAN_PLACE_ID}/share`)
        .set(as(sub))
        .send({ sharedWithUserId: sub === ALICE_SUB ? BOB_ID : ALICE_ID });
      expect(placeShare.status).toBe(404);

      for (const [entityType, entityId] of [
        ["route", PLAN_ROUTE_ID],
        ["geoPdfJob", planGeoPdfId],
      ]) {
        const share = await request(API_URL)
          .post("/shares")
          .set(as(sub))
          .send({
            entityType,
            entityId,
            sharedWithUserId: sub === ALICE_SUB ? BOB_ID : ALICE_ID,
          });
        expect(share.status).toBe(404);
      }

      const send = await request(API_URL)
        .post("/file-sends/from-media")
        .set(as(sub))
        .send({
          mediaId: planMediaId,
          recipientIds: [sub === ALICE_SUB ? BOB_ID : ALICE_ID],
        });
      expect(send.status).toBe(404);
    }
  });

  // Mutation: let a null owner match in filterOwnedPlaceIds or
  // filterOwnedEntityIds.
  it("a bulk share grants nothing", async () => {
    const res = await request(API_URL)
      .post("/bulk-share")
      .set(as(ALICE_SUB))
      .send({
        batchId: randomUUID(),
        recipientIds: [BOB_ID],
        items: [
          { entityType: "place", entityId: PLAN_PLACE_ID },
          { entityType: "route", entityId: PLAN_ROUTE_ID },
          { entityType: "geoPdfJob", entityId: planGeoPdfId },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ granted: 0, alreadyShared: 0, ineligible: 3 });
    expect(
      await prisma.placeShare.count({ where: { placeId: PLAN_PLACE_ID } }),
    ).toBe(0);
    expect(
      await prisma.share.count({
        where: { entityId: { in: [PLAN_ROUTE_ID, planGeoPdfId] } },
      }),
    ).toBe(0);
  });
});

describe("every by-id path 404s on a plan row", () => {
  // Mutation: same as above, or drop a `!row?.ownerId` / `!row?.userId`
  // check where a route loads a row by id.
  const paths = (): [string, string, object?][] => [
    ["get", `/places/${PLAN_PLACE_ID}`],
    ["patch", `/places/${PLAN_PLACE_ID}`, { name: "renamed" }],
    ["delete", `/places/${PLAN_PLACE_ID}`],
    ["post", `/places/${PLAN_PLACE_ID}/copy`, {}],
    ["get", `/places/${PLAN_PLACE_ID}/shares`],
    ["get", `/routes/${PLAN_ROUTE_ID}`],
    ["patch", `/routes/${PLAN_ROUTE_ID}`, { name: "renamed" }],
    ["delete", `/routes/${PLAN_ROUTE_ID}`],
    ["post", `/routes/${PLAN_ROUTE_ID}/copy`, {}],
    ["patch", `/media/${planMediaId}`, { displayName: "renamed" }],
    ["post", `/media/${planMediaId}/link`, { linkedType: "none" }],
    ["delete", `/media/${planMediaId}`],
    ["get", `/geo-pdf/${planGeoPdfId}`],
    ["delete", `/geo-pdf/${planGeoPdfId}`],
  ];

  it.each(EVERYONE)("as %s", async (sub) => {
    for (const [method, path, body] of paths()) {
      const req = request(API_URL)[method as "get"](path).set(as(sub));
      const res = await (body ? req.send(body) : req);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    // Nothing changed or went.
    expect(
      await prisma.place.findUnique({ where: { id: PLAN_PLACE_ID } }),
    ).toMatchObject({
      planId: SEED_PLAN_ID,
      name: "Wollangambe meeting point",
    });
    expect(
      await prisma.route.findUnique({ where: { id: PLAN_ROUTE_ID } }),
    ).toMatchObject({ planId: SEED_PLAN_ID });
    expect(
      await prisma.media.findUnique({ where: { id: planMediaId } }),
    ).toMatchObject({ planId: SEED_PLAN_ID, displayName: null });
    expect(
      await prisma.geoPdfJob.findUnique({ where: { id: planGeoPdfId } }),
    ).toMatchObject({ planId: SEED_PLAN_ID });
  });

  it("a /sync/push update or delete changes nothing", async () => {
    // Mutation: let applyPlaceOp/applyRouteOp accept a row whose owner is null.
    const res = await request(API_URL)
      .post("/sync/push")
      .set(as(ALICE_SUB))
      .set(CLIENT)
      .send({
        protocol: 1,
        ops: [
          {
            opId: "plan-u",
            entity: "place",
            op: "update",
            id: PLAN_PLACE_ID,
            fields: { notes: "pushed" },
          },
          {
            opId: "plan-r",
            entity: "route",
            op: "update",
            id: PLAN_ROUTE_ID,
            fields: { name: "pushed" },
          },
          { opId: "plan-d", entity: "place", op: "delete", id: PLAN_PLACE_ID },
          { opId: "plan-rd", entity: "route", op: "delete", id: PLAN_ROUTE_ID },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual([
      "rejected",
      "rejected",
      "alreadyApplied",
      "alreadyApplied",
    ]);
    expect(
      await prisma.place.findUnique({ where: { id: PLAN_PLACE_ID } }),
    ).toMatchObject({ notes: null });
    expect(
      await prisma.route.findUnique({ where: { id: PLAN_ROUTE_ID } }),
    ).toMatchObject({ name: "Walk in to the Wollangambe" });
  });
});

describe("deleting a plan", () => {
  // Mutation: make any child's plan FK anything but ON DELETE CASCADE.
  it("deletes everything in it", async () => {
    const plan = await prisma.tripPlan.create({
      data: { name: "cascade-test", createdById: ALICE_ID },
    });
    const planId = plan.id;
    await prisma.tripPlanMember.create({
      data: { planId, userId: ALICE_ID, role: "leader", status: "active" },
    });
    await prisma.tripPlanInvite.create({
      data: {
        planId,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.tripPlanSection.create({
      data: { planId, title: "Overview", position: 0 },
    });
    const form = await prisma.tripPlanForm.create({
      data: { planId, title: "Gear", visibleTo: "members", position: 0 },
    });
    await prisma.tripPlanAnswer.create({
      data: { formId: form.id, userId: ALICE_ID, answers: {} },
    });
    await prisma.place.create({
      data: {
        planId,
        placeTypeId: MARKER_TYPE_ID,
        name: "cascade-test",
        latitude: -33.5,
        longitude: 150.3,
      },
    });
    await prisma.route.create({
      data: {
        planId,
        name: "cascade-test",
        color: "#000000",
        points: [
          [150.3, -33.5],
          [150.31, -33.51],
        ],
      },
    });
    await prisma.media.create({
      data: {
        planId,
        linkedType: "none",
        s3KeyDisplay: "cascade-test",
        mediaType: "application/gpx+xml",
        filename: "cascade.gpx",
        fileSizeBytes: 1n,
      },
    });
    await prisma.geoPdfJob.create({
      data: { planId, config: {}, vectorStyleSnapshot: {} },
    });

    await prisma.tripPlan.delete({ where: { id: planId } });

    const counts = await Promise.all([
      prisma.tripPlanMember.count({ where: { planId } }),
      prisma.tripPlanInvite.count({ where: { planId } }),
      prisma.tripPlanSection.count({ where: { planId } }),
      prisma.tripPlanForm.count({ where: { planId } }),
      prisma.tripPlanAnswer.count({ where: { formId: form.id } }),
      prisma.place.count({ where: { planId } }),
      prisma.route.count({ where: { planId } }),
      prisma.media.count({ where: { planId } }),
      prisma.geoPdfJob.count({ where: { planId } }),
    ]);
    expect(counts).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
