import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import {
  API_URL,
  ALICE_SUB,
  BOB_SUB,
  CAROL_SUB,
  ALICE_ID,
  BOB_ID,
  SHARED_PLACE_ID,
  BOB_SHARED_PLACE_ID,
  BOB_SHARED_WAYPOINT_ID,
  NONEXISTENT_ID,
  as,
  CANYON_TYPE_ID
} from "./_actors";

// Sharing-audit surface (fix 24): GET/DELETE /friends/:id/shares.
//
// BOTH SHARE TABLES. The payload used to be place-only; it now speaks the
// (entityType, entityId) pair the bulk share speaks, and covers the `Share`
// table too (waypoint / route / topo / GeoPDF) — so the phone's per-friend
// screen can list everything a friend can see rather than the places alone.
//
// Requires `make dev` (Postgres + MiniStack + API on :8080) with AUTH_MODE=fake.
// Seed baseline: alice owns 4 places shared with bob (incl. SHARED_PLACE_ID);
// bob shares two rows back with alice (BOB_SHARED_PLACE_ID and
// BOB_SHARED_WAYPOINT_ID); alice<->bob is an accepted friendship; carol->alice
// is PENDING and carol is shared nothing.
//
// The incoming pair is named in `_actors.ts` rather than assumed absent. Three
// tests here asserted alice's received list was `[]`, which was true only while
// the seed had no incoming shares at all — and this suite is NOT in CI, so the
// seed change that added them landed green and broke it silently.
//
// The bulk-revoke test destroys the seeded alice->bob shares, and
// SHARED_PLACE_ID-is-shared-with-bob is an invariant the rest of the suite
// (shareBoundary.test.ts) depends on. So the forward shares are snapshotted in
// beforeAll and re-created in afterAll UNCONDITIONALLY — a mid-test failure
// must not leave the seed broken for the next file.

type ShareRow = {
  entityType: string;
  entityId: string;
  name: string | null;
  sharedAt: string;
  alsoViaPlace?: true;
};
type SharesBody = { sharedWithThem: ShareRow[]; sharedWithYou: ShareRow[] };

/** The place ids in one direction of the payload. */
function placeIdsIn(rows: ShareRow[]): string[] {
  return rows.filter((row) => row.entityType === "place").map((row) => row.entityId);
}

/** A throwaway unlinked route owned by `sub`, for the `Share`-table arm. */
async function createRoute(sub: string, name: string): Promise<string> {
  const res = await request(API_URL)
    .post("/routes")
    .set(as(sub))
    .send({
      name,
      points: [
        [150.31, -33.31],
        [150.32, -33.32],
      ],
    });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

let aliceBobFriendshipId: string;
let seededForwardShares: ShareRow[] = [];

async function friendshipIdFor(sub: string, otherUserId: string): Promise<string> {
  const res = await request(API_URL).get("/friends").set(as(sub));
  expect(res.status).toBe(200);
  const row = res.body.find((f: { id: string }) => f.id === otherUserId);
  expect(row, "expected an accepted friendship in the seed").toBeTruthy();
  return row.friendshipId as string;
}

beforeAll(async () => {
  aliceBobFriendshipId = await friendshipIdFor(ALICE_SUB, BOB_ID);
  const res = await request(API_URL)
    .get(`/friends/${aliceBobFriendshipId}/shares`)
    .set(as(ALICE_SUB));
  expect(res.status).toBe(200);
  seededForwardShares = (res.body as SharesBody).sharedWithThem;
});

afterAll(async () => {
  // Restore every seeded alice->bob PLACE share the bulk-revoke test removed.
  // (Routes created by this file are throwaways — nothing depends on them.)
  for (const row of seededForwardShares.filter((r) => r.entityType === "place")) {
    await request(API_URL)
      .post(`/places/${row.entityId}/share`)
      .set(as(ALICE_SUB))
      .send({ sharedWithUserId: BOB_ID });
  }
});

describe("GET /friends/:id/shares — the audit surface", () => {
  it("lists the places alice shares with bob", async () => {
    const res = await request(API_URL)
      .get(`/friends/${aliceBobFriendshipId}/shares`)
      .set(as(ALICE_SUB));
    expect(res.status).toBe(200);
    const body = res.body as SharesBody;
    expect(body.sharedWithThem.length).toBeGreaterThan(0);
    expect(placeIdsIn(body.sharedWithThem)).toContain(SHARED_PLACE_ID);
    // Every row names its table — a client cannot act on a row it cannot type.
    for (const row of body.sharedWithThem) {
      expect(typeof row.entityType).toBe("string");
      expect(typeof row.entityId).toBe("string");
    }
  });

  // The reverse direction is exactly what the seed says bob shares with alice,
  // and nothing else. Asserted as an exact SET rather than a `toContain`: this
  // test's job is to prove the two directions do not bleed into each other, and
  // a containment check would still pass if alice's own outgoing rows leaked in.
  it("reports the reverse direction as bob's incoming shares, and only those", async () => {
    const res = await request(API_URL)
      .get(`/friends/${aliceBobFriendshipId}/shares`)
      .set(as(ALICE_SUB));
    expect(res.status).toBe(200);
    const received = (res.body as SharesBody).sharedWithYou;
    expect(received.map((row) => row.entityId).sort()).toEqual(
      [BOB_SHARED_PLACE_ID, BOB_SHARED_WAYPOINT_ID].sort(),
    );
  });

  // The mirror: the same friendship read from bob's side must invert, and must
  // NOT show bob alice's other recipients.
  it("inverts when read from bob's side", async () => {
    const bobFriendshipId = await friendshipIdFor(BOB_SUB, ALICE_ID);
    const res = await request(API_URL)
      .get(`/friends/${bobFriendshipId}/shares`)
      .set(as(BOB_SUB));
    expect(res.status).toBe(200);
    const body = res.body as SharesBody;
    // Bob's forward list is what HE owns and shares — the same two rows alice
    // saw as incoming, now read from the other end of the same friendship.
    expect(body.sharedWithThem.map((row) => row.entityId).sort()).toEqual(
      [BOB_SHARED_PLACE_ID, BOB_SHARED_WAYPOINT_ID].sort(),
    );
    // ...and alice's places appear in his received list.
    expect(placeIdsIn(body.sharedWithYou)).toContain(SHARED_PLACE_ID);
  });

  // THE UNION. A waypoint/route/topo/GeoPDF share lives in the `Share` table,
  // which this surface used not to read at all — so a friend holding six items
  // saw an audit screen that said "nothing shared".
  it("lists a directly-shared ROUTE alongside the places, in both directions", async () => {
    const routeId = await createRoute(ALICE_SUB, "friend-shares-union");
    const grant = await request(API_URL)
      .post("/shares")
      .set(as(ALICE_SUB))
      .send({ entityType: "route", entityId: routeId, sharedWithUserId: BOB_ID });
    expect(grant.status).toBe(201);

    const mine = await request(API_URL)
      .get(`/friends/${aliceBobFriendshipId}/shares`)
      .set(as(ALICE_SUB));
    expect(mine.status).toBe(200);
    const row = (mine.body as SharesBody).sharedWithThem.find(
      (r) => r.entityId === routeId,
    );
    expect(row, "the shared route should appear in alice's forward list").toBeTruthy();
    expect(row!.entityType).toBe("route");
    expect(row!.name).toBe("friend-shares-union");

    // And in bob's received list, from his own side of the same friendship.
    const bobFriendshipId = await friendshipIdFor(BOB_SUB, ALICE_ID);
    const theirs = await request(API_URL)
      .get(`/friends/${bobFriendshipId}/shares`)
      .set(as(BOB_SUB));
    expect(theirs.status).toBe(200);
    expect(
      (theirs.body as SharesBody).sharedWithYou.map((r) => r.entityId),
    ).toContain(routeId);
    // Alice's route is not bob's to share on, so it never joins HIS forward
    // list — which holds only what the seed says bob owns and shares.
    expect(
      (theirs.body as SharesBody).sharedWithThem.map((r) => r.entityId).sort(),
    ).toEqual([BOB_SHARED_PLACE_ID, BOB_SHARED_WAYPOINT_ID].sort());
  });

  // The ownership arm: the list is derived from who OWNS the row, not from the
  // share's `sharedById`. Carol's own route, shared with bob, is bob's business
  // and carol's — it must not appear anywhere in alice's audit of bob.
  it("never lists a row a third party owns", async () => {
    const carolRoute = await createRoute(CAROL_SUB, "friend-shares-not-alices");
    const mine = await request(API_URL)
      .get(`/friends/${aliceBobFriendshipId}/shares`)
      .set(as(ALICE_SUB));
    expect(mine.status).toBe(200);
    const body = mine.body as SharesBody;
    expect(body.sharedWithThem.map((r) => r.entityId)).not.toContain(carolRoute);
    expect(body.sharedWithYou.map((r) => r.entityId)).not.toContain(carolRoute);
  });

  // THE FLAG THE CLIENTS CANNOT DERIVE. A waypoint shared directly AND linked
  // to a place its owner also shared is visible for two reasons; dropping the
  // direct share changes nothing, so a Remove offered on it would appear to
  // work and be undone by the next delta pull. Only the server can answer this
  // — a client deriving it from its own mirror is wrong until that mirror has
  // pulled the linked row (seen on device, 2026-09-05).
  it("marks a received row that ALSO rides a place the friend shared", async () => {
    // A place of bob's, shared with alice.
    const place = await request(API_URL)
      .post("/places")
      .set(as(BOB_SUB))
      .send({ placeTypeId: CANYON_TYPE_ID, name: "friend-shares-inherit", latitude: -33.57, longitude: 150.39 });
    expect(place.status).toBe(201);
    const placeId = place.body.id as string;
    await request(API_URL)
      .post(`/places/${placeId}/share`)
      .set(as(BOB_SUB))
      .send({ sharedWithUserId: ALICE_ID });

    // A waypoint LINKED to it, shared directly as well — the two-arm case.
    const linked = await request(API_URL)
      .post("/waypoints")
      .set(as(BOB_SUB))
      .send({
        name: "friend-shares-linked-wp",
        latitude: -33.571,
        longitude: 150.391,
        placeIds: [placeId],
      });
    expect(linked.status).toBe(201);
    // ...and one linked to nothing, shared the same way.
    const loose = await request(API_URL)
      .post("/waypoints")
      .set(as(BOB_SUB))
      .send({ name: "friend-shares-loose-wp", latitude: -33.572, longitude: 150.392 });
    expect(loose.status).toBe(201);

    for (const id of [linked.body.id, loose.body.id]) {
      await request(API_URL)
        .post("/shares")
        .set(as(BOB_SUB))
        .send({ entityType: "waypoint", entityId: id, sharedWithUserId: ALICE_ID });
    }

    const res = await request(API_URL)
      .get(`/friends/${aliceBobFriendshipId}/shares`)
      .set(as(ALICE_SUB));
    expect(res.status).toBe(200);
    const received = (res.body as SharesBody).sharedWithYou;
    const linkedRow = received.find((r) => r.entityId === linked.body.id);
    const looseRow = received.find((r) => r.entityId === loose.body.id);
    expect(linkedRow?.alsoViaPlace).toBe(true);
    // The loose one is removable, so the flag must be ABSENT rather than false-y
    // by accident — a client reads it to decide whether to offer Remove at all.
    expect(looseRow).toBeTruthy();
    expect(looseRow?.alsoViaPlace).toBeUndefined();
  });

  // Privacy rule: /friends never returns email. This surface joins shares to
  // places only, so the guarantee is structural — assert it holds on the wire.
  it("never leaks an email address", async () => {
    const res = await request(API_URL)
      .get(`/friends/${aliceBobFriendshipId}/shares`)
      .set(as(ALICE_SUB));
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("@");
    expect(raw).not.toContain("email");
  });

  it("403s for a user who is not a member of the friendship", async () => {
    const res = await request(API_URL)
      .get(`/friends/${aliceBobFriendshipId}/shares`)
      .set(as(CAROL_SUB));
    expect(res.status).toBe(403);
  });

  it("404s for an unknown friendship id", async () => {
    const res = await request(API_URL)
      .get("/friends/00000000-0000-0000-0000-0000000000ff/shares")
      .set(as(ALICE_SUB));
    expect(res.status).toBe(404);
  });

  // carol->alice is pending in the seed: not a sharing relationship yet.
  it("400s on a pending friendship", async () => {
    const requests = await request(API_URL)
      .get("/friends/requests")
      .set(as(ALICE_SUB));
    expect(requests.status).toBe(200);
    const pending = requests.body[0];
    expect(pending, "expected the seeded carol->alice pending request").toBeTruthy();
    const res = await request(API_URL)
      .get(`/friends/${pending.id as string}/shares`)
      .set(as(ALICE_SUB));
    expect(res.status).toBe(400);
  });
});

describe("DELETE /friends/:id/shares — unshare all", () => {
  it("403s for a non-member (carol cannot revoke alice's shares)", async () => {
    const res = await request(API_URL)
      .delete(`/friends/${aliceBobFriendshipId}/shares`)
      .set(as(CAROL_SUB));
    expect(res.status).toBe(403);
  });

  // The subset arm a phone multi-select needs: revoke the three rows the user
  // picked, and nothing else.
  it("revokes only the items named in the body", async () => {
    const routeId = await createRoute(ALICE_SUB, "friend-shares-subset");
    await request(API_URL)
      .post("/shares")
      .set(as(ALICE_SUB))
      .send({ entityType: "route", entityId: routeId, sharedWithUserId: BOB_ID });

    const del = await request(API_URL)
      .delete(`/friends/${aliceBobFriendshipId}/shares`)
      .set(as(ALICE_SUB))
      .send({ items: [{ entityType: "route", entityId: routeId }] });
    expect(del.status).toBe(200);
    expect(del.body.revokedCount).toBe(1);
    expect(del.body.itemsRevokedCount).toBe(1);
    expect(del.body.placesRevokedCount).toBe(0);

    const after = await request(API_URL)
      .get(`/friends/${aliceBobFriendshipId}/shares`)
      .set(as(ALICE_SUB));
    const rows = (after.body as SharesBody).sharedWithThem;
    // The route is gone...
    expect(rows.map((r) => r.entityId)).not.toContain(routeId);
    // ...and the seeded place shares are untouched.
    expect(placeIdsIn(rows)).toContain(SHARED_PLACE_ID);
  });

  // An EMPTY list is not "everything": a client that computed a selection and
  // came up with none must not be read as having asked for the lot.
  it("revokes nothing for an explicitly empty item list", async () => {
    const del = await request(API_URL)
      .delete(`/friends/${aliceBobFriendshipId}/shares`)
      .set(as(ALICE_SUB))
      .send({ items: [] });
    expect(del.status).toBe(200);
    expect(del.body.revokedCount).toBe(0);

    const after = await request(API_URL)
      .get(`/friends/${aliceBobFriendshipId}/shares`)
      .set(as(ALICE_SUB));
    expect(placeIdsIn((after.body as SharesBody).sharedWithThem)).toContain(
      SHARED_PLACE_ID,
    );
  });

  // Ids in the body authorize nothing: they filter a set derived from the
  // caller's own ownership. Carol's place cannot be revoked by naming it, and
  // the count must not report whether it existed (SEC-001's anti-oracle rule).
  it("cannot revoke a row the caller does not own by naming it", async () => {
    const carolRoute = await createRoute(CAROL_SUB, "friend-shares-foreign");
    const del = await request(API_URL)
      .delete(`/friends/${aliceBobFriendshipId}/shares`)
      .set(as(ALICE_SUB))
      .send({
        items: [
          { entityType: "route", entityId: carolRoute },
          { entityType: "place", entityId: NONEXISTENT_ID },
        ],
      });
    expect(del.status).toBe(200);
    expect(del.body.revokedCount).toBe(0);

    // Carol still owns and can read her route.
    const carolRead = await request(API_URL)
      .get(`/routes/${carolRoute}`)
      .set(as(CAROL_SUB));
    expect(carolRead.status).toBe(200);
  });

  // Runs last in this file: it destroys the seeded shares, and afterAll rebuilds
  // them.
  it("revokes every place alice shares with bob, and only those", async () => {
    const before = await request(API_URL)
      .get(`/friends/${aliceBobFriendshipId}/shares`)
      .set(as(ALICE_SUB));
    const expected = (before.body as SharesBody).sharedWithThem.length;
    expect(expected).toBeGreaterThan(0);

    const del = await request(API_URL)
      .delete(`/friends/${aliceBobFriendshipId}/shares`)
      .set(as(ALICE_SUB));
    expect(del.status).toBe(200);
    expect(del.body.revokedCount).toBe(expected);

    // The audit surface now reports nothing shared...
    const after = await request(API_URL)
      .get(`/friends/${aliceBobFriendshipId}/shares`)
      .set(as(ALICE_SUB));
    expect((after.body as SharesBody).sharedWithThem).toEqual([]);

    // ...and bob genuinely lost access — 404, not 403 (anti-oracle).
    const bobRead = await request(API_URL)
      .get(`/places/${SHARED_PLACE_ID}`)
      .set(as(BOB_SUB));
    expect(bobRead.status).toBe(404);

    // The friendship itself survives — that's the difference from unfriending.
    const stillFriends = await request(API_URL).get("/friends").set(as(ALICE_SUB));
    expect(stillFriends.body.map((f: { id: string }) => f.id)).toContain(BOB_ID);
  });
});
