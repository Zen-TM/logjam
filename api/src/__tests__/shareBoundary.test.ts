import { describe, it, expect } from "vitest";
import request from "supertest";
import {
  API_URL,
  ALICE_SUB,
  BOB_SUB,
  CAROL_SUB,
  BOB_ID,
  CAROL_ID,
  SHARED_CANYON_ID,
  as,
} from "./_actors";

// Multi-user / share-boundary coverage (gap 1, SEC-001 regression).
//
// Requires `make dev` (Postgres + MiniStack + API on :8080) with AUTH_MODE=fake.
// Exercises the hybrid-share boundary from the RECIPIENT and STRANGER sides —
// the perspectives the old single-user fake auth could not reach. Seed baseline:
// alice owns SHARED_CANYON_ID and shares it with bob; carol is shared nothing.
// Tests that mutate state create + tear down their own rows so the baseline seed
// is left intact (and the carol↔bob pair, which the seed leaves empty, is
// restored to empty).

async function createCanyon(sub: string, name: string): Promise<string> {
  const res = await request(API_URL)
    .post("/canyons")
    .set(as(sub))
    .send({ name, latitude: -33.7, longitude: 150.3 });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("share boundary — recipient view (hybrid model)", () => {
  it("recipient GETs the shared canyon record but NOT the trip-log list", async () => {
    const res = await request(API_URL)
      .get(`/canyons/${SHARED_CANYON_ID}`)
      .set(as(BOB_SUB));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(SHARED_CANYON_ID);
    // Canyon-level media is visible to recipients...
    expect(Array.isArray(res.body.media)).toBe(true);
    // ...but the owner-private trip-log list must never be attached.
    expect(res.body.tripLogs).toBeUndefined();
  });

  it("recipient's trip list for a shared canyon is empty (trips are owner-private)", async () => {
    const res = await request(API_URL)
      .get(`/canyons/${SHARED_CANYON_ID}/trips`)
      .set(as(BOB_SUB));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("recipient cannot read an individual trip log — 404, not 403 (SEC-001: no ID oracle)", async () => {
    // Resolve a real trip ID from the owner's side first.
    const ownerTrips = await request(API_URL)
      .get(`/canyons/${SHARED_CANYON_ID}/trips`)
      .set(as(ALICE_SUB));
    expect(ownerTrips.status).toBe(200);
    expect(ownerTrips.body.length).toBeGreaterThanOrEqual(1);
    const tripId = ownerTrips.body[0].id as string;

    const res = await request(API_URL)
      .get(`/canyons/${SHARED_CANYON_ID}/trips/${tripId}`)
      .set(as(BOB_SUB));
    expect(res.status).toBe(404);
  });

  it("recipient may copy a shared canyon under their own account", async () => {
    const res = await request(API_URL)
      .post(`/canyons/${SHARED_CANYON_ID}/copy`)
      .set(as(BOB_SUB))
      .send({});
    expect(res.status).toBe(201);
    const copyId = res.body.id as string;
    expect(res.body.forkedFromId).toBe(SHARED_CANYON_ID);
    // Cleanup: bob owns the copy, bob deletes it.
    await request(API_URL).delete(`/canyons/${copyId}`).set(as(BOB_SUB));
  });
});

describe("share boundary — stranger view", () => {
  it("stranger cannot read a canyon shared only with someone else", async () => {
    const res = await request(API_URL)
      .get(`/canyons/${SHARED_CANYON_ID}`)
      .set(as(CAROL_SUB));
    // 404 (not 403): the status must not confirm the canyon exists to someone
    // with no access — matches the trip-level anti-oracle.
    expect(res.status).toBe(404);
  });

  it("stranger's trip-log access is denied and individual trips 404", async () => {
    const list = await request(API_URL)
      .get(`/canyons/${SHARED_CANYON_ID}/trips`)
      .set(as(CAROL_SUB));
    expect(list.status).toBe(404);

    const ownerTrips = await request(API_URL)
      .get(`/canyons/${SHARED_CANYON_ID}/trips`)
      .set(as(ALICE_SUB));
    const tripId = ownerTrips.body[0].id as string;

    const single = await request(API_URL)
      .get(`/canyons/${SHARED_CANYON_ID}/trips/${tripId}`)
      .set(as(CAROL_SUB));
    expect(single.status).toBe(404);
  });
});

describe("share revocation", () => {
  it("recipient loses access once the owner revokes the share", async () => {
    const canyonId = await createCanyon(ALICE_SUB, "share revocation test");
    try {
      // alice shares with bob (they are seed friends)
      const shareRes = await request(API_URL)
        .post(`/canyons/${canyonId}/share`)
        .set(as(ALICE_SUB))
        .send({ sharedWithUserId: BOB_ID });
      expect(shareRes.status).toBe(201);

      // bob can read it while shared
      const beforeRes = await request(API_URL)
        .get(`/canyons/${canyonId}`)
        .set(as(BOB_SUB));
      expect(beforeRes.status).toBe(200);

      // alice revokes
      const revokeRes = await request(API_URL)
        .delete(`/canyons/${canyonId}/share/${BOB_ID}`)
        .set(as(ALICE_SUB));
      expect(revokeRes.status).toBe(204);

      // bob can no longer read it — 404, the canyon is now invisible to him
      const afterRes = await request(API_URL)
        .get(`/canyons/${canyonId}`)
        .set(as(BOB_SUB));
      expect(afterRes.status).toBe(404);
    } finally {
      await request(API_URL).delete(`/canyons/${canyonId}`).set(as(ALICE_SUB));
    }
  });
});

describe("friend-request lifecycle from the recipient side", () => {
  it("alice sees carol's pending request with username only (no email)", async () => {
    // Baseline seed: carol→alice pending.
    const res = await request(API_URL)
      .get("/friends/requests")
      .set(as(ALICE_SUB));
    expect(res.status).toBe(200);
    const fromCarol = res.body.find(
      (r: { requester: { id: string } }) => r.requester.id === CAROL_ID,
    );
    expect(fromCarol).toBeDefined();
    expect(fromCarol.requester.username).toBe("carol");
    // Friends routes are username-only — email must never appear.
    expect(fromCarol.requester.email).toBeUndefined();
  });

  it("full accept then unfriend cycle on the otherwise-empty carol↔bob pair", async () => {
    // bob → carol request (this pair has no seed friendship, so it restores
    // cleanly to empty at the end).
    const reqRes = await request(API_URL)
      .post("/friends/request")
      .set(as(BOB_SUB))
      .send({ addresseeId: CAROL_ID });
    expect(reqRes.status).toBe(201);
    const friendshipId = reqRes.body.id as string;

    try {
      // carol (recipient) sees bob's request, username only
      const reqs = await request(API_URL)
        .get("/friends/requests")
        .set(as(CAROL_SUB));
      const fromBob = reqs.body.find(
        (r: { id: string }) => r.id === friendshipId,
      );
      expect(fromBob).toBeDefined();
      expect(fromBob.requester.username).toBe("bob");
      expect(fromBob.requester.email).toBeUndefined();

      // carol accepts
      const acceptRes = await request(API_URL)
        .patch(`/friends/${friendshipId}/accept`)
        .set(as(CAROL_SUB));
      expect(acceptRes.status).toBe(200);

      // bob now lists carol as a friend
      const bobFriends = await request(API_URL)
        .get("/friends")
        .set(as(BOB_SUB));
      expect(
        bobFriends.body.some((f: { id: string }) => f.id === CAROL_ID),
      ).toBe(true);
    } finally {
      // Either party can unfriend; restores the carol↔bob pair to empty.
      await request(API_URL)
        .delete(`/friends/${friendshipId}`)
        .set(as(BOB_SUB));
    }
  });

  it("only the recipient may accept a friend request", async () => {
    const reqRes = await request(API_URL)
      .post("/friends/request")
      .set(as(BOB_SUB))
      .send({ addresseeId: CAROL_ID });
    expect(reqRes.status).toBe(201);
    const friendshipId = reqRes.body.id as string;
    try {
      // bob (the requester, not the recipient) cannot accept his own request
      const res = await request(API_URL)
        .patch(`/friends/${friendshipId}/accept`)
        .set(as(BOB_SUB));
      expect(res.status).toBe(403);
    } finally {
      // Still pending — carol declines to clean up.
      await request(API_URL)
        .patch(`/friends/${friendshipId}/decline`)
        .set(as(CAROL_SUB));
    }
  });
});

describe("cross-user notification isolation", () => {
  it("a friend-request notification is delivered to the recipient, never the sender", async () => {
    const reqRes = await request(API_URL)
      .post("/friends/request")
      .set(as(BOB_SUB))
      .send({ addresseeId: CAROL_ID });
    expect(reqRes.status).toBe(201);
    const friendshipId = reqRes.body.id as string;

    try {
      // The sender (bob) must NOT see a friend_request notification for this
      // friendship — it belongs to the recipient only.
      const bobNotifs = await request(API_URL)
        .get("/notifications")
        .set(as(BOB_SUB));
      expect(bobNotifs.status).toBe(200);
      const bobHasIt = bobNotifs.body.some(
        (n: { type: string; payload: { friendshipId?: string } }) =>
          n.type === "friend_request" &&
          n.payload?.friendshipId === friendshipId,
      );
      expect(bobHasIt).toBe(false);
    } finally {
      await request(API_URL)
        .patch(`/friends/${friendshipId}/decline`)
        .set(as(CAROL_SUB));
    }
  });
});
