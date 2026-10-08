import { describe, it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import prisma from "../services/prisma";
import { ALICE_ID, BOB_ID, CAROL_ID, NONEXISTENT_ID } from "./_actors";

// Requires `make dev` running with AUTH_MODE=fake (requests = seeded alice).
// Baseline seed (api/prisma/seed.ts):
//   - alice <-> bob: accepted friendship
//   - carol  -> alice: pending request
// These tests only READ the baseline relationships and exercise validation
// branches that do not mutate them, to stay non-destructive to the shared DB.
const API_URL = process.env.API_URL ?? "http://localhost:8080";
const AUTH = { Authorization: "Bearer fake-token" } as const;

describe("friends routes (fake auth = alice)", () => {
  it("GET /friends lists accepted friends (bob) and never leaks email", async () => {
    const res = await request(API_URL).get("/friends").set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const bob = res.body.find((f: { id: string }) => f.id === BOB_ID);
    expect(bob).toBeTruthy();
    expect(bob.username).toBe("bob");
    expect(bob.friendshipId).toBeTruthy();
    // Privacy rule: friend lists are username-only.
    for (const friend of res.body) {
      expect(friend.email).toBeUndefined();
    }
  });

  it("GET /friends/requests lists pending requests received (carol -> alice)", async () => {
    const res = await request(API_URL).get("/friends/requests").set(AUTH);
    expect(res.status).toBe(200);
    const fromCarol = res.body.find(
      (r: { requester: { id: string } }) => r.requester.id === CAROL_ID,
    );
    expect(fromCarol).toBeTruthy();
    expect(fromCarol.status).toBe("pending");
    expect(fromCarol.requester.email).toBeUndefined();
  });

  it("POST /friends/request rejects self-requests", async () => {
    const res = await request(API_URL)
      .post("/friends/request")
      .set(AUTH)
      .send({ addresseeId: ALICE_ID });
    expect(res.status).toBe(400);
  });

  it("POST /friends/request is idempotent — 409 when already friends with bob", async () => {
    const res = await request(API_URL)
      .post("/friends/request")
      .set(AUTH)
      .send({ addresseeId: BOB_ID });
    expect(res.status).toBe(409);
  });

  it("POST /friends/request answers an unknown id exactly as a blocked pair (no user-existence oracle)", async () => {
    // Mutation that turns this red: restoring the distinct 404 for a missing
    // addressee in routes/friends.ts.
    const unknown = await request(API_URL)
      .post("/friends/request")
      .set(AUTH)
      .send({ addresseeId: NONEXISTENT_ID });
    // The blocked pair is a throwaway user blocking alice; no API creates one,
    // and rows of our own leave the seeded users and friendships alone.
    const tag = randomUUID();
    const blocker = await prisma.user.create({
      data: {
        cognitoId: `blocker-${tag}`,
        username: `blocker-${tag.slice(0, 8)}`,
        email: `blocker-${tag}@example.invalid`,
      },
    });
    await prisma.friendship.create({
      data: {
        requesterId: blocker.id,
        addresseeId: ALICE_ID,
        status: "blocked",
      },
    });
    try {
      const blocked = await request(API_URL)
        .post("/friends/request")
        .set(AUTH)
        .send({ addresseeId: blocker.id });
      expect(blocked.status).toBe(403);
      expect(unknown.status).toBe(blocked.status);
      // requestId differs per request; the message is what could tell them apart.
      expect(unknown.body.error).toBe(blocked.body.error);
    } finally {
      await prisma.user.delete({ where: { id: blocker.id } });
    }
  });

  it("PATCH /friends/:id/accept 404s for a non-existent friendship", async () => {
    const res = await request(API_URL)
      .patch(`/friends/${NONEXISTENT_ID}/accept`)
      .set(AUTH);
    expect(res.status).toBe(404);
  });

  it("GET /friends/search rejects queries shorter than 3 characters", async () => {
    const res = await request(API_URL)
      .get("/friends/search")
      .query({ q: "ab" })
      .set(AUTH);
    expect(res.status).toBe(400);
  });

  it("GET /friends/search returns username-only matches excluding self", async () => {
    const res = await request(API_URL)
      .get("/friends/search")
      .query({ q: "bob" })
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const match of res.body) {
      expect(match.id).not.toBe(ALICE_ID);
      expect(match.email).toBeUndefined();
    }
    // The count is of the same matches, self excluded. Mutation: drop the
    // where from the count and it includes alice / non-matches.
    expect(Number(res.headers["x-total-count"])).toBeGreaterThanOrEqual(
      res.body.length,
    );
    const all = await request(API_URL)
      .get("/friends/search")
      .query({ q: "zzzzqqqq" })
      .set(AUTH);
    expect(all.headers["x-total-count"]).toBe("0");
  });
});
