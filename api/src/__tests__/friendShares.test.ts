import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import {
  API_URL,
  ALICE_SUB,
  BOB_SUB,
  CAROL_SUB,
  ALICE_ID,
  BOB_ID,
  SHARED_CANYON_ID,
  as,
} from "./_actors";

// Sharing-audit surface (fix 24): GET/DELETE /friends/:id/shares.
//
// Requires `make dev` (Postgres + MiniStack + API on :8080) with AUTH_MODE=fake.
// Seed baseline: alice owns 4 canyons shared with bob (incl. SHARED_CANYON_ID);
// alice<->bob is an accepted friendship; carol->alice is PENDING and carol is
// shared nothing.
//
// The bulk-revoke test destroys the seeded alice->bob shares, and
// SHARED_CANYON_ID-is-shared-with-bob is an invariant the rest of the suite
// (shareBoundary.test.ts) depends on. So the forward shares are snapshotted in
// beforeAll and re-created in afterAll UNCONDITIONALLY — a mid-test failure
// must not leave the seed broken for the next file.

type ShareRow = { canyonId: string; name: string; sharedAt: string };
type SharesBody = { sharedWithThem: ShareRow[]; sharedWithYou: ShareRow[] };

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
  // Restore every seeded alice->bob share the bulk-revoke test removed.
  for (const row of seededForwardShares) {
    await request(API_URL)
      .post(`/canyons/${row.canyonId}/share`)
      .set(as(ALICE_SUB))
      .send({ sharedWithUserId: BOB_ID });
  }
});

describe("GET /friends/:id/shares — the audit surface", () => {
  it("lists the canyons alice shares with bob", async () => {
    const res = await request(API_URL)
      .get(`/friends/${aliceBobFriendshipId}/shares`)
      .set(as(ALICE_SUB));
    expect(res.status).toBe(200);
    const body = res.body as SharesBody;
    expect(body.sharedWithThem.length).toBeGreaterThan(0);
    expect(body.sharedWithThem.map((r) => r.canyonId)).toContain(
      SHARED_CANYON_ID,
    );
  });

  it("reports the reverse direction as empty — bob shares nothing with alice", async () => {
    const res = await request(API_URL)
      .get(`/friends/${aliceBobFriendshipId}/shares`)
      .set(as(ALICE_SUB));
    expect(res.status).toBe(200);
    expect((res.body as SharesBody).sharedWithYou).toEqual([]);
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
    // Bob owns none of these, so his forward list is empty...
    expect(body.sharedWithThem).toEqual([]);
    // ...and alice's canyons appear in his received list.
    expect(body.sharedWithYou.map((r) => r.canyonId)).toContain(
      SHARED_CANYON_ID,
    );
  });

  // Privacy rule: /friends never returns email. This surface joins shares to
  // canyons only, so the guarantee is structural — assert it holds on the wire.
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

  // Runs last in this file: it destroys the seeded shares, and afterAll rebuilds
  // them.
  it("revokes every canyon alice shares with bob, and only those", async () => {
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
      .get(`/canyons/${SHARED_CANYON_ID}`)
      .set(as(BOB_SUB));
    expect(bobRead.status).toBe(404);

    // The friendship itself survives — that's the difference from unfriending.
    const stillFriends = await request(API_URL).get("/friends").set(as(ALICE_SUB));
    expect(stillFriends.body.map((f: { id: string }) => f.id)).toContain(BOB_ID);
  });
});
