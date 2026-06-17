import { describe, it, expect } from "vitest";
import request from "supertest";

// Requires `make dev` to be running (Postgres + MiniStack + API on :8080) with
// AUTH_MODE=fake (every request authenticates as the seeded alice user).
//
// These tests create their own canyons and delete them again, so they do not
// mutate the baseline seed (5 alice canyons, 2 shared with bob).
const API_URL = process.env.API_URL ?? "http://localhost:8080";
const AUTH = { Authorization: "Bearer fake-token" } as const;

// Seed user IDs (api/prisma/seed.ts).
const BOB_ID = "00000000-0000-0000-0000-000000000002";

const NONEXISTENT_ID = "99999999-9999-9999-9999-999999999999";

async function createCanyon(name: string): Promise<string> {
  const res = await request(API_URL)
    .post("/canyons")
    .set(AUTH)
    .send({ name, latitude: -33.7, longitude: 150.3 });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("canyons routes (fake auth = alice)", () => {
  it("GET /canyons returns the owner's canyons", async () => {
    const res = await request(API_URL).get("/canyons").set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Seed gives alice 5 canyons; she owns at least those.
    expect(res.body.length).toBeGreaterThanOrEqual(5);
  });

  it("POST /canyons rejects a body missing required fields", async () => {
    const res = await request(API_URL)
      .post("/canyons")
      .set(AUTH)
      .send({ name: "No coords" });
    expect(res.status).toBe(400);
  });

  it("GET /canyons/:id returns owned canyon with trip logs and media arrays", async () => {
    const id = await createCanyon("CH-003 detail test");
    try {
      const res = await request(API_URL).get(`/canyons/${id}`).set(AUTH);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(id);
      // Owner view exposes the trip log list and media array.
      expect(Array.isArray(res.body.tripLogs)).toBe(true);
      expect(Array.isArray(res.body.media)).toBe(true);
    } finally {
      await request(API_URL).delete(`/canyons/${id}`).set(AUTH);
    }
  });

  it("GET /canyons/:id returns 404 for a non-existent canyon", async () => {
    const res = await request(API_URL)
      .get(`/canyons/${NONEXISTENT_ID}`)
      .set(AUTH);
    expect(res.status).toBe(404);
  });

  it("DELETE /canyons/:id cascades trip logs then removes the canyon", async () => {
    const id = await createCanyon("CH-003 cascade test");

    // Attach a trip log so we exercise the cascade delete path.
    const tripRes = await request(API_URL)
      .post(`/canyons/${id}/trips`)
      .set(AUTH)
      .send({ date: "2024-05-01", notes: "cascade trip" });
    expect(tripRes.status).toBe(201);

    const delRes = await request(API_URL).delete(`/canyons/${id}`).set(AUTH);
    expect(delRes.status).toBe(204);

    // Canyon is gone.
    const afterRes = await request(API_URL).get(`/canyons/${id}`).set(AUTH);
    expect(afterRes.status).toBe(404);

    // Its trip logs are gone too (cascade) — the trips list 404s on the canyon.
    const tripsAfter = await request(API_URL)
      .get(`/canyons/${id}/trips`)
      .set(AUTH);
    expect([403, 404]).toContain(tripsAfter.status);
  });

  it("POST /canyons/:id/copy forks an accessible canyon under the caller", async () => {
    const id = await createCanyon("CH-003 copy source");
    let copyId: string | undefined;
    try {
      const copyRes = await request(API_URL)
        .post(`/canyons/${id}/copy`)
        .set(AUTH)
        .send({});
      expect(copyRes.status).toBe(201);
      copyId = copyRes.body.id as string;
      expect(copyId).not.toBe(id);
      expect(copyRes.body.forkedFromId).toBe(id);
    } finally {
      if (copyId) await request(API_URL).delete(`/canyons/${copyId}`).set(AUTH);
      await request(API_URL).delete(`/canyons/${id}`).set(AUTH);
    }
  });

  it("GET /canyons/shared lists canyons shared WITH alice (none in baseline seed)", async () => {
    // Baseline: alice is the sharer, not a recipient, so her shared list is
    // empty. Share one of her own canyons with bob and confirm it does NOT
    // appear in alice's own shared list (she is the owner, not the recipient).
    const id = await createCanyon("CH-003 shared list test");
    try {
      const shareRes = await request(API_URL)
        .post(`/canyons/${id}/share`)
        .set(AUTH)
        .send({ sharedWithUserId: BOB_ID });
      expect(shareRes.status).toBe(201);

      const sharedRes = await request(API_URL)
        .get("/canyons/shared")
        .set(AUTH);
      expect(sharedRes.status).toBe(200);
      expect(
        sharedRes.body.some((c: { id: string }) => c.id === id),
      ).toBe(false);
    } finally {
      await request(API_URL).delete(`/canyons/${id}`).set(AUTH);
    }
  });
});
