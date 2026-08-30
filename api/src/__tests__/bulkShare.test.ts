import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import {
  API_URL,
  ALICE_SUB,
  BOB_SUB,
  CAROL_SUB,
  ALICE_ID,
  BOB_ID,
  CAROL_ID,
  NONEXISTENT_ID,
  as,
} from "./_actors";

// POST /bulk-share — "share these things with these friends", in one request.
//
// Requires `make dev` (Postgres + MiniStack + API on :8080) with AUTH_MODE=fake.
// Every test creates and tears down its own rows so the baseline seed is left
// intact.
//
// What is worth an integration test here, as opposed to the unit test on the
// arithmetic (`lib/bulkShare.unit.test.ts`):
//   - the two TABLES really do both get written from one mixed list,
//   - the counts the user is shown match what the database ended up with,
//   - a foreign or missing id is COUNTED, never named (the aggregate form of
//     the 404-not-403 anti-oracle),
//   - the friends-only rule fails the WHOLE request rather than part-sharing,
//   - the recipient's notifications carry the batchId the inbox groups on.
//
// BOB IS THE SHARER in the multi-recipient tests: the seed gives alice exactly
// one friend (bob), and bob two (alice and carol), so bob is the only actor who
// can exercise the recipient dimension of the cross product.

async function createCanyon(sub: string, name: string): Promise<string> {
  const res = await request(API_URL)
    .post("/canyons")
    .set(as(sub))
    .send({ name, latitude: -33.7, longitude: 150.3 });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function deleteCanyon(sub: string, id: string): Promise<void> {
  await request(API_URL).delete(`/canyons/${id}`).set(as(sub));
}

async function shareRecipientIds(sub: string, canyonId: string): Promise<string[]> {
  const res = await request(API_URL).get(`/canyons/${canyonId}/shares`).set(as(sub));
  expect(res.status).toBe(200);
  return res.body.map((row: { sharedWith: { id: string } }) => row.sharedWith.id);
}

// The bob↔carol friendship is in the seed, but `shareBoundary.test.ts` clears
// it and deliberately leaves the pair EMPTY (that pair is its blank slate). So
// this file restores it rather than assuming it, and the two suites can run in
// either order.
beforeAll(async () => {
  const friends = await request(API_URL).get("/friends").set(as(BOB_SUB));
  expect(friends.status).toBe(200);
  if (friends.body.some((row: { id: string }) => row.id === CAROL_ID)) return;
  const asked = await request(API_URL)
    .post("/friends/request")
    .set(as(BOB_SUB))
    .send({ addresseeId: CAROL_ID });
  expect(asked.status).toBe(201);
  const accepted = await request(API_URL)
    .patch(`/friends/${asked.body.id as string}/accept`)
    .set(as(CAROL_SUB));
  expect(accepted.status).toBe(200);
});

describe("POST /bulk-share", () => {
  it("writes the whole cross product and reports it", async () => {
    const first = await createCanyon(BOB_SUB, "Bulk share A");
    const second = await createCanyon(BOB_SUB, "Bulk share B");
    try {
      const res = await request(API_URL)
        .post("/bulk-share")
        .set(as(BOB_SUB))
        .send({
          items: [
            { entityType: "canyon", entityId: first },
            { entityType: "canyon", entityId: second },
          ],
          recipientIds: [ALICE_ID, CAROL_ID],
          batchId: randomUUID(),
        });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ granted: 4, alreadyShared: 0, ineligible: 0 });

      // The counts are only worth anything if the rows match them.
      expect((await shareRecipientIds(BOB_SUB, first)).sort()).toEqual(
        [ALICE_ID, CAROL_ID].sort(),
      );
      expect((await shareRecipientIds(BOB_SUB, second)).sort()).toEqual(
        [ALICE_ID, CAROL_ID].sort(),
      );
    } finally {
      await deleteCanyon(BOB_SUB, first);
      await deleteCanyon(BOB_SUB, second);
    }
  });

  it("re-sharing is a no-op, not a 409 — a bulk selection routinely overlaps", async () => {
    const canyonId = await createCanyon(BOB_SUB, "Bulk share repeat");
    try {
      const body = {
        items: [{ entityType: "canyon", entityId: canyonId }],
        recipientIds: [ALICE_ID, CAROL_ID],
      };
      const first = await request(API_URL)
        .post("/bulk-share")
        .set(as(BOB_SUB))
        .send({ ...body, batchId: randomUUID() });
      expect(first.status).toBe(200);
      expect(first.body.granted).toBe(2);

      const again = await request(API_URL)
        .post("/bulk-share")
        .set(as(BOB_SUB))
        .send({ ...body, batchId: randomUUID() });
      expect(again.status).toBe(200);
      expect(again.body).toEqual({ granted: 0, alreadyShared: 2, ineligible: 0 });
      // Still exactly two rows, not four.
      expect(await shareRecipientIds(BOB_SUB, canyonId)).toHaveLength(2);
    } finally {
      await deleteCanyon(BOB_SUB, canyonId);
    }
  });

  it("COUNTS an id that isn't the caller's, and never says which", async () => {
    // Alice's canyon and an id that exists nowhere are indistinguishable in the
    // response — the aggregate form of the 404-not-403 rule (SEC-001). Naming
    // either one would confirm to bob that it exists.
    const mine = await createCanyon(BOB_SUB, "Bulk share mine");
    const hers = await createCanyon(ALICE_SUB, "Alice's own canyon");
    try {
      const res = await request(API_URL)
        .post("/bulk-share")
        .set(as(BOB_SUB))
        .send({
          items: [
            { entityType: "canyon", entityId: mine },
            { entityType: "canyon", entityId: hers },
            { entityType: "canyon", entityId: NONEXISTENT_ID },
          ],
          recipientIds: [CAROL_ID],
          batchId: randomUUID(),
        });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ granted: 1, alreadyShared: 0, ineligible: 2 });
      // Counts only — nothing id-shaped comes back.
      expect(Object.keys(res.body).sort()).toEqual([
        "alreadyShared",
        "granted",
        "ineligible",
      ]);
      expect(JSON.stringify(res.body)).not.toContain(hers);
      expect(JSON.stringify(res.body)).not.toContain(NONEXISTENT_ID);

      // And alice's canyon really was not shared.
      expect(await shareRecipientIds(ALICE_SUB, hers)).toEqual([]);
    } finally {
      await deleteCanyon(BOB_SUB, mine);
      await deleteCanyon(ALICE_SUB, hers);
    }
  });

  it("refuses the WHOLE request for a non-friend rather than partly sharing", async () => {
    // A partial fan-out the sender was never told about is worse than an error.
    const canyonId = await createCanyon(BOB_SUB, "Bulk share stranger");
    try {
      const res = await request(API_URL)
        .post("/bulk-share")
        .set(as(BOB_SUB))
        .send({
          items: [{ entityType: "canyon", entityId: canyonId }],
          recipientIds: [ALICE_ID, NONEXISTENT_ID],
          batchId: randomUUID(),
        });
      expect(res.status).toBe(403);
      // Alice, the legitimate half of the list, got nothing.
      expect(await shareRecipientIds(BOB_SUB, canyonId)).toEqual([]);
    } finally {
      await deleteCanyon(BOB_SUB, canyonId);
    }
  });

  it("stamps the batchId on the recipient's notifications, for the inbox to group on", async () => {
    const first = await createCanyon(ALICE_SUB, "Bulk share notify A");
    const second = await createCanyon(ALICE_SUB, "Bulk share notify B");
    const batchId = randomUUID();
    try {
      const res = await request(API_URL)
        .post("/bulk-share")
        .set(as(ALICE_SUB))
        .send({
          items: [
            { entityType: "canyon", entityId: first },
            { entityType: "canyon", entityId: second },
          ],
          recipientIds: [BOB_ID],
          batchId,
        });
      expect(res.status).toBe(200);
      expect(res.body.granted).toBe(2);

      const inbox = await request(API_URL).get("/notifications").set(as(BOB_SUB));
      expect(inbox.status).toBe(200);
      const batched = inbox.body.filter(
        (n: { payload: { batchId?: string } }) => n.payload.batchId === batchId,
      );
      expect(batched).toHaveLength(2);
      // Ids only in the payload (PRIV-005) — the canyon NAME is resolved at
      // read time, so it appears in the response but was never stored.
      expect(batched[0].type).toBe("canyon_shared");
      expect(batched[0].payload.canyonId).toBeTypeOf("string");
    } finally {
      // Deleting the canyons purges the shares and the notifications with them.
      await deleteCanyon(ALICE_SUB, first);
      await deleteCanyon(ALICE_SUB, second);
    }
  });

  it("rejects a malformed request rather than doing part of it", async () => {
    const canyonId = await createCanyon(ALICE_SUB, "Bulk share malformed");
    try {
      const base = {
        items: [{ entityType: "canyon", entityId: canyonId }],
        recipientIds: [BOB_ID],
        batchId: randomUUID(),
      };
      // A batchId is required: without one the recipient gets N loose rows,
      // which is the thing the feature exists to prevent.
      const noBatch = await request(API_URL)
        .post("/bulk-share")
        .set(as(ALICE_SUB))
        .send({ ...base, batchId: undefined });
      expect(noBatch.status).toBe(400);

      const badBatch = await request(API_URL)
        .post("/bulk-share")
        .set(as(ALICE_SUB))
        .send({ ...base, batchId: "not-a-uuid" });
      expect(badBatch.status).toBe(400);

      const badType = await request(API_URL)
        .post("/bulk-share")
        .set(as(ALICE_SUB))
        .send({ ...base, items: [{ entityType: "tripLog", entityId: canyonId }] });
      expect(badType.status).toBe(400);

      // Nothing at all in the action.
      const empty = await request(API_URL)
        .post("/bulk-share")
        .set(as(ALICE_SUB))
        .send({ ...base, items: [], copyCount: 0 });
      expect(empty.status).toBe(400);

      // Every rejection above left the canyon unshared.
      expect(await shareRecipientIds(ALICE_SUB, canyonId)).toEqual([]);
    } finally {
      await deleteCanyon(ALICE_SUB, canyonId);
    }
  });

  it("caps the item list at 413 rather than doing unbounded per-element work", async () => {
    const items = Array.from({ length: 201 }, () => ({
      entityType: "canyon",
      entityId: NONEXISTENT_ID,
    }));
    const res = await request(API_URL)
      .post("/bulk-share")
      .set(as(ALICE_SUB))
      .send({ items, recipientIds: [BOB_ID], batchId: randomUUID() });
    expect(res.status).toBe(413);
  });

  it("shares a WAYPOINT and a canyon from one mixed list — two tables, one call", async () => {
    const canyonId = await createCanyon(ALICE_SUB, "Bulk share mixed");
    const waypoint = await request(API_URL)
      .post("/waypoints")
      .set(as(ALICE_SUB))
      .send({ name: "Bulk share carpark", latitude: -33.7, longitude: 150.3 });
    expect(waypoint.status).toBe(201);
    const waypointId = waypoint.body.id as string;
    try {
      const res = await request(API_URL)
        .post("/bulk-share")
        .set(as(ALICE_SUB))
        .send({
          items: [
            { entityType: "canyon", entityId: canyonId },
            { entityType: "waypoint", entityId: waypointId },
          ],
          recipientIds: [BOB_ID],
          batchId: randomUUID(),
        });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ granted: 2, alreadyShared: 0, ineligible: 0 });

      // The canyon went to CanyonShare, the waypoint to Share — different
      // tables, one request.
      expect(await shareRecipientIds(ALICE_SUB, canyonId)).toEqual([BOB_ID]);
      const shares = await request(API_URL)
        .get(`/shares/waypoint/${waypointId}`)
        .set(as(ALICE_SUB));
      expect(shares.status).toBe(200);
      expect(
        shares.body.map((row: { sharedWith: { id: string } }) => row.sharedWith.id),
      ).toEqual([BOB_ID]);
    } finally {
      await request(API_URL).delete(`/waypoints/${waypointId}`).set(as(ALICE_SUB));
      await deleteCanyon(ALICE_SUB, canyonId);
    }
  });

  it("a sharee may not re-share what was shared with them", async () => {
    const canyonId = await createCanyon(ALICE_SUB, "Bulk share resharer");
    try {
      const grant = await request(API_URL)
        .post("/bulk-share")
        .set(as(ALICE_SUB))
        .send({
          items: [{ entityType: "canyon", entityId: canyonId }],
          recipientIds: [BOB_ID],
          batchId: randomUUID(),
        });
      expect(grant.status).toBe(200);
      expect(grant.body.granted).toBe(1);

      // Bob can SEE it and still cannot pass it on — ineligible, counted, not
      // named, and identical to what a stranger's request would come back as.
      const reshare = await request(API_URL)
        .post("/bulk-share")
        .set(as(BOB_SUB))
        .send({
          items: [{ entityType: "canyon", entityId: canyonId }],
          recipientIds: [CAROL_ID],
          batchId: randomUUID(),
        });
      expect(reshare.status).toBe(200);
      expect(reshare.body).toEqual({ granted: 0, alreadyShared: 0, ineligible: 1 });
      expect(await shareRecipientIds(ALICE_SUB, canyonId)).toEqual([BOB_ID]);
    } finally {
      await deleteCanyon(ALICE_SUB, canyonId);
    }
  });
});
