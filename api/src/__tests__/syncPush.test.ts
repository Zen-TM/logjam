import { describe, it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";
import { API_URL, ALICE_SUB, BOB_SUB, BOB_ID, as } from "./_actors";

// POST /sync/push contract (Stage 8 §8): FIFO order, per-op transactions,
// per-op statuses, dependencyFailed propagation, conflict receipts, and the
// foreign-id anti-oracle. Requires `make dev`. Synthetic coords only.

const CLIENT = { "x-logjam-client": "mobile/0.1.0-test" } as const;

function push(sub: string, ops: unknown[]) {
  return request(API_URL)
    .post("/sync/push")
    .set(as(sub))
    .set(CLIENT)
    .send({ protocol: 1, ops });
}

describe("sync push — request contract", () => {
  it("requires the client header, protocol 1, and 1..50 ops", async () => {
    const noHeader = await request(API_URL)
      .post("/sync/push")
      .set(as(ALICE_SUB))
      .send({ protocol: 1, ops: [] });
    expect(noHeader.status).toBe(400);

    expect((await push(ALICE_SUB, [])).status).toBe(400);

    const badProtocol = await request(API_URL)
      .post("/sync/push")
      .set(as(ALICE_SUB))
      .set(CLIENT)
      .send({ protocol: 2, ops: [{}] });
    expect(badProtocol.status).toBe(400);

    const tooMany = await push(
      ALICE_SUB,
      Array.from({ length: 51 }, () => ({
        opId: randomUUID(),
        entity: "waypoint",
        op: "delete",
        id: randomUUID(),
      })),
    );
    expect(tooMany.status).toBe(413);
  });
});

describe("sync push — FIFO batch lifecycle", () => {
  it("create canyon → trip linking it → waypoint on it; replay is alreadyApplied; delete wins", async () => {
    const canyonId = randomUUID();
    const tripId = randomUUID();
    const waypointId = randomUUID();
    const ops = [
      {
        opId: "op-canyon",
        entity: "canyon",
        op: "create",
        id: canyonId,
        fields: { name: "Push canyon", latitude: -33.61, longitude: 150.21 },
      },
      {
        opId: "op-trip",
        entity: "tripLog",
        op: "create",
        id: tripId,
        fields: { date: "2026-07-10", canyonIds: [canyonId] },
      },
      {
        opId: "op-wp",
        entity: "waypoint",
        op: "create",
        id: waypointId,
        fields: {
          name: "Push anchor",
          latitude: -33.62,
          longitude: 150.22,
          canyonId,
        },
      },
    ];

    const first = await push(ALICE_SUB, ops);
    expect(first.status).toBe(200);
    expect(first.body.results.map((r: { status: string }) => r.status)).toEqual([
      "applied",
      "applied",
      "applied",
    ]);
    // The created trip carries the canyoning tag (validation parity with the
    // REST route, not a parallel dialect).
    const tripRow = first.body.results[1].row;
    expect(tripRow.types).toContain("canyoning");
    expect(tripRow.canyons.map((c: { id: string }) => c.id)).toEqual([canyonId]);

    // Whole-batch replay (network drop after apply): everything idempotent.
    const replay = await push(ALICE_SUB, ops);
    expect(replay.body.results.map((r: { status: string }) => r.status)).toEqual([
      "alreadyApplied",
      "alreadyApplied",
      "alreadyApplied",
    ]);

    // Deletes: applied, then alreadyApplied on replay.
    const deletes = [
      { opId: "d-wp", entity: "waypoint", op: "delete", id: waypointId },
      { opId: "d-trip", entity: "tripLog", op: "delete", id: tripId },
      { opId: "d-canyon", entity: "canyon", op: "delete", id: canyonId },
    ];
    const del = await push(ALICE_SUB, deletes);
    expect(del.body.results.map((r: { status: string }) => r.status)).toEqual([
      "applied",
      "applied",
      "applied",
    ]);
    const delReplay = await push(ALICE_SUB, deletes);
    expect(
      delReplay.body.results.map((r: { status: string }) => r.status),
    ).toEqual(["alreadyApplied", "alreadyApplied", "alreadyApplied"]);
  });

  it("a rejected create fails its dependents (dependencyFailed), independents still apply", async () => {
    const badCanyonId = randomUUID();
    const goodWaypointId = randomUUID();
    const res = await push(ALICE_SUB, [
      {
        opId: "bad-canyon",
        entity: "canyon",
        op: "create",
        id: badCanyonId,
        // latitude out of range → rejected 400
        fields: { name: "Bad", latitude: 95, longitude: 150.2 },
      },
      {
        opId: "dependent-trip",
        entity: "tripLog",
        op: "create",
        id: randomUUID(),
        fields: { date: "2026-07-11", canyonIds: [badCanyonId] },
      },
      {
        opId: "independent-wp",
        entity: "waypoint",
        op: "create",
        id: goodWaypointId,
        fields: { name: "Fine", latitude: -33.63, longitude: 150.23 },
      },
    ]);
    const statuses = res.body.results.map((r: { status: string }) => r.status);
    expect(statuses).toEqual(["rejected", "dependencyFailed", "applied"]);
    expect(res.body.results[0].error.code).toBe(400);

    // cleanup
    await push(ALICE_SUB, [
      { opId: "c", entity: "waypoint", op: "delete", id: goodWaypointId },
    ]);
  });

  it("unknown field key → rejected, not silently dropped", async () => {
    const res = await push(ALICE_SUB, [
      {
        opId: "unknown-field",
        entity: "waypoint",
        op: "create",
        id: randomUUID(),
        fields: {
          name: "x",
          latitude: -33.6,
          longitude: 150.2,
          futureField: true,
        },
      },
    ]);
    expect(res.body.results[0].status).toBe("rejected");
    expect(res.body.results[0].error.code).toBe(400);
  });
});

describe("sync push — conflicts (§6)", () => {
  it("stale base + server-differing field → appliedWithConflict, last flush wins, receipt carries the overwritten value", async () => {
    const canyonId = randomUUID();
    await push(ALICE_SUB, [
      {
        opId: "c",
        entity: "canyon",
        op: "create",
        id: canyonId,
        fields: { name: "Conflict canyon", latitude: -33.64, longitude: 150.24 },
      },
    ]);

    // "Web" edit bumps updatedAt and sets notes.
    const webEdit = await request(API_URL)
      .patch(`/canyons/${canyonId}`)
      .set(as(ALICE_SUB))
      .send({ notes: "web edit" });
    expect(webEdit.status).toBe(200);

    // Phone flush based on the pre-web-edit row.
    const staleBase = "2026-01-01T00:00:00.000Z";
    const res = await push(ALICE_SUB, [
      {
        opId: "u",
        entity: "canyon",
        op: "update",
        id: canyonId,
        baseUpdatedAt: staleBase,
        fields: { notes: "phone edit", quality: 4 },
      },
    ]);
    const result = res.body.results[0];
    expect(result.status).toBe("appliedWithConflict");
    // Last flush wins…
    expect(result.row.notes).toBe("phone edit");
    expect(result.row.quality).toBe(4);
    // …and receipts shelve every replaced value while the base was stale.
    // The server over-reports by contract (no per-field history): quality's
    // receipt carries the pre-write null, which the CLIENT drops as a
    // self-conflict because it matches its own base value.
    expect(result.conflicts).toEqual([
      { field: "notes", serverValue: "web edit" },
      { field: "quality", serverValue: null },
    ]);

    // Same edit with a fresh base → plain applied, no receipts.
    const fresh = await push(ALICE_SUB, [
      {
        opId: "u2",
        entity: "canyon",
        op: "update",
        id: canyonId,
        baseUpdatedAt: result.row.updatedAt,
        fields: { notes: "second phone edit" },
      },
    ]);
    expect(fresh.body.results[0].status).toBe("applied");

    await push(ALICE_SUB, [
      { opId: "d", entity: "canyon", op: "delete", id: canyonId },
    ]);
  });

  it("update on a deleted row → rejected 404 (delete wins; client parks deadRemote)", async () => {
    const res = await push(ALICE_SUB, [
      {
        opId: "ghost",
        entity: "canyon",
        op: "update",
        id: randomUUID(),
        fields: { notes: "too late" },
      },
    ]);
    expect(res.body.results[0].status).toBe("rejected");
    expect(res.body.results[0].error.code).toBe(404);
  });
});

describe("sync push — ownership boundary", () => {
  it("foreign update/create-replay both read as 404-rejected, indistinguishable from nonexistent", async () => {
    const canyonId = randomUUID();
    await push(ALICE_SUB, [
      {
        opId: "c",
        entity: "canyon",
        op: "create",
        id: canyonId,
        fields: { name: "Alice push", latitude: -33.66, longitude: 150.26 },
      },
    ]);

    const bobUpdate = await push(BOB_SUB, [
      {
        opId: "steal-u",
        entity: "canyon",
        op: "update",
        id: canyonId,
        fields: { notes: "bob was here" },
      },
    ]);
    expect(bobUpdate.body.results[0].status).toBe("rejected");
    expect(bobUpdate.body.results[0].error.code).toBe(404);

    const bobCreate = await push(BOB_SUB, [
      {
        opId: "steal-c",
        entity: "canyon",
        op: "create",
        id: canyonId,
        fields: { name: "Bob claim", latitude: -33.67, longitude: 150.27 },
      },
    ]);
    expect(bobCreate.body.results[0].status).toBe("rejected");
    expect(bobCreate.body.results[0].error.code).toBe(404);

    // Bob deleting alice's canyon: alreadyApplied (goal state "not there"
    // from bob's view) — and the row must SURVIVE.
    const bobDelete = await push(BOB_SUB, [
      { opId: "steal-d", entity: "canyon", op: "delete", id: canyonId },
    ]);
    expect(bobDelete.body.results[0].status).toBe("alreadyApplied");
    const stillThere = await request(API_URL)
      .get(`/canyons/${canyonId}`)
      .set(as(ALICE_SUB));
    expect(stillThere.status).toBe(200);

    await push(ALICE_SUB, [
      { opId: "d", entity: "canyon", op: "delete", id: canyonId },
    ]);
  });
});

describe("sync push — route colour", () => {
  // Colour used to be assigned server-side and ignored on the wire, so a route
  // drawn on a phone rendered in a fallback colour and then changed under the
  // user when the create op came back.
  it("honours a palette colour on create and update, and refuses one outside it", async () => {
    const routeId = randomUUID();
    const points = [
      [150.4, -33.5],
      [150.41, -33.51],
    ];

    const created = await push(ALICE_SUB, [
      {
        opId: `color-c-${routeId}`,
        entity: "route",
        op: "create",
        id: routeId,
        fields: { name: "Colour test", points, color: "#3cb44b" },
      },
    ]);
    expect(created.body.results[0].status).toBe("applied");
    const afterCreate = await request(API_URL)
      .get(`/routes/${routeId}`)
      .set(as(ALICE_SUB));
    expect(afterCreate.body.color).toBe("#3cb44b");

    await push(ALICE_SUB, [
      {
        opId: `color-u-${routeId}`,
        entity: "route",
        op: "update",
        id: routeId,
        fields: { color: "#e6194b" },
      },
    ]);
    const afterUpdate = await request(API_URL)
      .get(`/routes/${routeId}`)
      .set(as(ALICE_SUB));
    expect(afterUpdate.body.color).toBe("#e6194b");

    // Anything off-palette is rejected outright rather than stored.
    const bad = await push(ALICE_SUB, [
      {
        opId: `color-x-${routeId}`,
        entity: "route",
        op: "update",
        id: routeId,
        fields: { color: "javascript:alert(1)" },
      },
    ]);
    expect(bad.body.results[0].status).toBe("rejected");
    const unchanged = await request(API_URL)
      .get(`/routes/${routeId}`)
      .set(as(ALICE_SUB));
    expect(unchanged.body.color).toBe("#e6194b");

    await push(ALICE_SUB, [
      { opId: `color-d-${routeId}`, entity: "route", op: "delete", id: routeId },
    ]);
  });
});

describe("sync push — notification markRead", () => {
  it("markRead on a purged/foreign notification is alreadyApplied (monotonic, no oracle)", async () => {
    const res = await push(ALICE_SUB, [
      {
        opId: "mr",
        entity: "notification",
        op: "markRead",
        id: randomUUID(),
      },
    ]);
    expect(res.body.results[0].status).toBe("alreadyApplied");
  });

  // The same anti-oracle rule for the two ops mark-as-unread and delete added
  // with the inbox's per-row menu: a notification that is not this user's is
  // reported exactly as one that never existed.
  it("markUnread and delete on a purged/foreign notification are alreadyApplied", async () => {
    const res = await push(ALICE_SUB, [
      { opId: "mu", entity: "notification", op: "markUnread", id: randomUUID() },
      { opId: "nd", entity: "notification", op: "delete", id: randomUUID() },
    ]);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual([
      "alreadyApplied",
      "alreadyApplied",
    ]);
  });

  it("round-trips the read bit on a real notification", async () => {
    // Whatever alice's inbox already holds, flipped and put back — deliberately
    // NOT a delete: this suite runs against the seeded dev database, and a test
    // that eats a seeded row is one that thins the fixture every time it runs.
    const inbox = await request(API_URL).get("/notifications").set(as(ALICE_SUB));
    const target = (inbox.body as { id: string; read: boolean }[])[0];
    if (!target) return; // Nothing seeded to act on — the case above still covers the vocabulary.

    const readOf = async (id: string) => {
      const res = await request(API_URL).get("/notifications").set(as(ALICE_SUB));
      return (res.body as { id: string; read: boolean }[]).find((n) => n.id === id)?.read;
    };
    const flip = (op: "markRead" | "markUnread") =>
      push(ALICE_SUB, [
        { opId: `${op}-${target.id}-${Date.now()}`, entity: "notification", op, id: target.id },
      ]);

    const flipped = await flip(target.read ? "markUnread" : "markRead");
    expect(flipped.body.results[0].status).toBe("applied");
    expect(await readOf(target.id)).toBe(!target.read);

    await flip(target.read ? "markRead" : "markUnread");
    expect(await readOf(target.id)).toBe(target.read);
  });
});

describe("sync push — route anchors", () => {
  // Regression: the push handler accepted `anchors`, validated it, and then
  // dropped it — so every route drawn on a phone lost the user's own vertices
  // on the first pull after it flushed, and reopening a snapped route gave
  // back a handle on every snapped point. REST PATCH always applied the rule;
  // only this path didn't.
  it("persists anchors on create and update, and clears them when points move without anchors", async () => {
    const routeId = randomUUID();
    const points = [
      [150.4, -33.5],
      [150.41, -33.51],
      [150.42, -33.52],
      [150.43, -33.53],
    ];

    const created = await push(ALICE_SUB, [
      {
        opId: `anchors-c-${routeId}`,
        entity: "route",
        op: "create",
        id: routeId,
        fields: { name: "Anchors survive", points, anchors: [0, 3] },
      },
    ]);
    expect(created.body.results[0].status).toBe("applied");

    const afterCreate = await request(API_URL)
      .get(`/routes/${routeId}`)
      .set(as(ALICE_SUB));
    expect(afterCreate.body.anchors).toEqual([0, 3]);

    const updated = await push(ALICE_SUB, [
      {
        opId: `anchors-u-${routeId}`,
        entity: "route",
        op: "update",
        id: routeId,
        fields: { points, anchors: [0, 2, 3] },
      },
    ]);
    expect(updated.body.results[0].status).toBe("applied");
    const afterUpdate = await request(API_URL)
      .get(`/routes/${routeId}`)
      .set(as(ALICE_SUB));
    expect(afterUpdate.body.anchors).toEqual([0, 2, 3]);

    // Geometry without anchors clears them: stale indices into moved points
    // would be worse than no record at all.
    await push(ALICE_SUB, [
      {
        opId: `anchors-x-${routeId}`,
        entity: "route",
        op: "update",
        id: routeId,
        fields: { points: points.slice(0, 3) },
      },
    ]);
    const afterClear = await request(API_URL)
      .get(`/routes/${routeId}`)
      .set(as(ALICE_SUB));
    expect(afterClear.body.anchors).toBeNull();

    await push(ALICE_SUB, [
      { opId: `anchors-d-${routeId}`, entity: "route", op: "delete", id: routeId },
    ]);
  });
});

describe("sync push — direct-share delete cleanup", () => {
  // REST DELETE /routes/:id fans tombstones out to direct sharees and purges
  // their Share rows; the sync push delete used to do neither (finding 1), so a
  // waypoint/route deleted from a phone while offline stranded the recipient's
  // mirror AND left the Share row granting access to a dead id.
  it("a pushed route delete tombstones a direct sharee", async () => {
    const routeId = randomUUID();
    const created = await push(ALICE_SUB, [
      {
        opId: `share-del-c-${routeId}`,
        entity: "route",
        op: "create",
        id: routeId,
        fields: {
          name: "sync delete direct-share cleanup",
          points: [
            [150.1, -33.1],
            [150.2, -33.2],
          ],
        },
      },
    ]);
    expect(created.body.results[0].status).toBe("applied");

    const shareRes = await request(API_URL)
      .post("/shares")
      .set(as(ALICE_SUB))
      .send({ entityType: "route", entityId: routeId, sharedWithUserId: BOB_ID });
    expect(shareRes.status).toBe(201);

    const before = await request(API_URL)
      .get("/sync/delta")
      .query({ cursor: "" })
      .set(as(BOB_SUB))
      .set(CLIENT);
    const cursor = before.body.cursor;

    const del = await push(ALICE_SUB, [
      { opId: `share-del-d-${routeId}`, entity: "route", op: "delete", id: routeId },
    ]);
    expect(del.body.results[0].status).toBe("applied");

    const after = await request(API_URL)
      .get("/sync/delta")
      .query({ cursor })
      .set(as(BOB_SUB))
      .set(CLIENT);
    expect(after.body.tombstones).toContainEqual({ type: "route", id: routeId });
  });
});
