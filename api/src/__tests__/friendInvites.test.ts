import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  ALICE_SUB,
  API_URL,
  BOB_ID,
  BOB_SUB,
  CAROL_ID,
  CAROL_SUB,
  as,
} from "./_actors";

// Friend invite links (routes/friendInvites.ts). Requires `make dev`.
//
// The seed leaves no two actors strangers (alice<->bob and bob<->carol are
// friends, carol -> alice is pending), so this file unfriends BOB and CAROL,
// then makes them friends again BY LINK: the last test restores the seed's
// graph, and `afterAll` proves it, or the next file inherits a broken one.
// The pending carol -> alice request is read and never spent.
//
// Mutations that turn it red: return the inviter's id or email from /preview;
// give a spent link a different status or message from an unknown one; skip
// the delete in /redeem (a link then works twice); return the token or its
// hash from GET /friends/invites.

const UNKNOWN_TOKEN = "A".repeat(43);

async function friendshipId(
  sub: string,
  otherId: string,
): Promise<string | null> {
  const res = await request(API_URL).get("/friends").set(as(sub));
  expect(res.status).toBe(200);
  const rows = res.body as { id: string; friendshipId: string }[];
  return rows.find((row) => row.id === otherId)?.friendshipId ?? null;
}

async function mint(sub: string): Promise<string> {
  const res = await request(API_URL).post("/friends/invites").set(as(sub));
  expect(res.status).toBe(201);
  return res.body.token as string;
}

const preview = (sub: string, token: unknown) =>
  request(API_URL)
    .post("/friends/invites/preview")
    .set(as(sub))
    .send({ token });

const redeem = (sub: string, token: unknown) =>
  request(API_URL).post("/friends/invites/redeem").set(as(sub)).send({ token });

describe("friend invite links", () => {
  let token: string;

  beforeAll(async () => {
    const existing = await friendshipId(BOB_SUB, CAROL_ID);
    if (existing) {
      const removed = await request(API_URL)
        .delete(`/friends/${existing}`)
        .set(as(BOB_SUB));
      expect(removed.status).toBe(204);
    }
    // Links left by an earlier run would make the list assertions lie.
    await request(API_URL).delete("/friends/invites").set(as(CAROL_SUB));
    token = await mint(CAROL_SUB);
  });

  afterAll(async () => {
    await request(API_URL).delete("/friends/invites").set(as(CAROL_SUB));
    if ((await friendshipId(BOB_SUB, CAROL_ID)) === null) {
      throw new Error("friendInvites: bob and carol were not left friends");
    }
  });

  it("lists the inviter's live links without the link or its hash", async () => {
    const res = await request(API_URL)
      .get("/friends/invites")
      .set(as(CAROL_SUB));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(Object.keys(res.body[0]).sort()).toEqual([
      "createdAt",
      "expiresAt",
      "id",
    ]);
    expect(JSON.stringify(res.body)).not.toContain(token);
    // Another user's links are not in mine.
    const bobs = await request(API_URL)
      .get("/friends/invites")
      .set(as(BOB_SUB));
    expect(bobs.body).toEqual([]);
  });

  it("previews the inviter by username only", async () => {
    const res = await preview(BOB_SUB, token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      inviter: { username: "carol" },
      alreadyFriends: false,
    });
  });

  it("tells the inviter the link is their own, and does not spend it", async () => {
    expect((await preview(CAROL_SUB, token)).status).toBe(400);
    expect((await redeem(CAROL_SUB, token)).status).toBe(400);
    expect((await preview(BOB_SUB, token)).status).toBe(200);
  });

  it("answers a malformed and an unknown token with the same 404", async () => {
    const unknown = await redeem(BOB_SUB, UNKNOWN_TOKEN);
    expect(unknown.status).toBe(404);
    for (const bad of [undefined, "", "short", 42, { $ne: null }]) {
      const res = await redeem(BOB_SUB, bad);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe(unknown.body.error);
      expect((await preview(BOB_SUB, bad)).status).toBe(404);
    }
  });

  it("leaves a link alone when its opener is already a friend", async () => {
    // alice <-> bob are friends in the seed.
    const bobToken = await mint(BOB_SUB);
    const seen = await preview(ALICE_SUB, bobToken);
    expect(seen.body.alreadyFriends).toBe(true);
    const res = await redeem(ALICE_SUB, bobToken);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(BOB_ID);
    const live = await request(API_URL)
      .get("/friends/invites")
      .set(as(BOB_SUB));
    expect(live.body).toHaveLength(1);
    await request(API_URL).delete("/friends/invites").set(as(BOB_SUB));
  });

  it("revokes every link the inviter has out", async () => {
    const doomed = await mint(CAROL_SUB);
    const revoked = await request(API_URL)
      .delete("/friends/invites")
      .set(as(CAROL_SUB));
    expect(revoked.status).toBe(204);
    expect((await redeem(BOB_SUB, doomed)).status).toBe(404);
    expect((await redeem(BOB_SUB, token)).status).toBe(404);
    token = await mint(CAROL_SUB);
  });

  it("makes the opener and the inviter friends, once", async () => {
    const res = await redeem(BOB_SUB, token);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(CAROL_ID);
    expect(res.body.username).toBe("carol");
    expect(res.body.email).toBeUndefined();
    expect(await friendshipId(CAROL_SUB, BOB_ID)).toBe(res.body.friendshipId);

    // Spent: for anyone else it is now the same 404 as a link that never was.
    const unknown = await redeem(ALICE_SUB, UNKNOWN_TOKEN);
    const again = await redeem(ALICE_SUB, token);
    expect(again.status).toBe(404);
    expect(again.body.error).toBe(unknown.body.error);
    expect((await preview(ALICE_SUB, token)).status).toBe(404);
    const live = await request(API_URL)
      .get("/friends/invites")
      .set(as(CAROL_SUB));
    expect(live.body).toEqual([]);
  });
});
