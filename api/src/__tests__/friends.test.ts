import { describe, it, expect } from "vitest";
import request from "supertest";
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
    const bob = res.body.find(
      (f: { id: string }) => f.id === BOB_ID,
    );
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

  it("POST /friends/request 404s for an unknown addressee", async () => {
    const res = await request(API_URL)
      .post("/friends/request")
      .set(AUTH)
      .send({ addresseeId: NONEXISTENT_ID });
    expect(res.status).toBe(404);
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
  });
});
