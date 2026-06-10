import { describe, it, expect } from "vitest";
import request from "supertest";

// Requires `make dev` running with AUTH_MODE=fake (requests = seeded alice).
//
// SEC-001 regression coverage for GET /canyons/:canyonId/trips/:id. Fake auth
// is single-user (alice), so the sharee/stranger perspectives cannot be
// exercised here — the share boundary itself ("shared"/"none" never reach
// owner-private trip data) is encoded in lib/canyonAccess.unit.test.ts. These
// tests pin the owner-perspective contract and the canyonId-path-match 404.
const API_URL = process.env.API_URL ?? "http://localhost:8080";
const AUTH = { Authorization: "Bearer fake-token" } as const;

const NONEXISTENT_ID = "99999999-9999-9999-9999-999999999999";

async function createCanyon(name: string): Promise<string> {
  const res = await request(API_URL)
    .post("/canyons")
    .set(AUTH)
    .send({ name, latitude: -33.7, longitude: 150.3 });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("trip log single GET (fake auth = alice)", () => {
  it("owner GET returns the trip with notes and media", async () => {
    const canyonId = await createCanyon("SEC-001 owner single GET");
    try {
      const createRes = await request(API_URL)
        .post(`/canyons/${canyonId}/trips`)
        .set(AUTH)
        .send({ date: "2026-06-01", notes: "owner-private beta" });
      expect(createRes.status).toBe(201);
      const tripId = createRes.body.id as string;

      const getRes = await request(API_URL)
        .get(`/canyons/${canyonId}/trips/${tripId}`)
        .set(AUTH);
      expect(getRes.status).toBe(200);
      expect(getRes.body.notes).toBe("owner-private beta");
      expect(Array.isArray(getRes.body.media)).toBe(true);
    } finally {
      await request(API_URL).delete(`/canyons/${canyonId}`).set(AUTH);
    }
  });

  it("404s when the trip exists but the :canyonId in the path mismatches", async () => {
    const canyonA = await createCanyon("SEC-001 path mismatch A");
    const canyonB = await createCanyon("SEC-001 path mismatch B");
    try {
      const createRes = await request(API_URL)
        .post(`/canyons/${canyonA}/trips`)
        .set(AUTH)
        .send({ date: "2026-06-01", notes: "trip on canyon A" });
      expect(createRes.status).toBe(201);
      const tripId = createRes.body.id as string;

      const res = await request(API_URL)
        .get(`/canyons/${canyonB}/trips/${tripId}`)
        .set(AUTH);
      expect(res.status).toBe(404);
      expect(res.body.notes).toBeUndefined();
    } finally {
      await request(API_URL).delete(`/canyons/${canyonA}`).set(AUTH);
      await request(API_URL).delete(`/canyons/${canyonB}`).set(AUTH);
    }
  });

  it("404s for a non-existent trip id", async () => {
    const canyonId = await createCanyon("SEC-001 missing trip");
    try {
      const res = await request(API_URL)
        .get(`/canyons/${canyonId}/trips/${NONEXISTENT_ID}`)
        .set(AUTH);
      expect(res.status).toBe(404);
    } finally {
      await request(API_URL).delete(`/canyons/${canyonId}`).set(AUTH);
    }
  });
});
