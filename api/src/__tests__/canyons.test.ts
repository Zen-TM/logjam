import { describe, it, expect } from "vitest";
import request from "supertest";
import { BOB_ID, NONEXISTENT_ID } from "./_actors";

// Requires `make dev` to be running (Postgres + MiniStack + API on :8080) with
// AUTH_MODE=fake (every request authenticates as the seeded alice user).
//
// These tests create their own canyons and delete them again, so they do not
// mutate the baseline seed (5 alice canyons, 2 shared with bob).
const API_URL = process.env.API_URL ?? "http://localhost:8080";
const AUTH = { Authorization: "Bearer fake-token" } as const;

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

  it("DELETE /canyons/:id detaches its sole-linked trip log (keeps it, backfills displayName) then removes the canyon", async () => {
    const canyonName = "CH-003 detach test";
    const id = await createCanyon(canyonName);

    // Attach a trip log so we exercise the detach path (creation moved to the
    // global POST /trips surface — the nested POST was removed).
    const tripRes = await request(API_URL)
      .post("/trips")
      .set(AUTH)
      .send({ canyonIds: [id], date: "2024-05-01", notes: "detach trip" });
    expect(tripRes.status).toBe(201);
    const tripId = tripRes.body.id as string;
    expect(tripRes.body.displayName).toBeNull();

    const delRes = await request(API_URL).delete(`/canyons/${id}`).set(AUTH);
    expect(delRes.status).toBe(204);

    // Canyon is gone.
    const afterRes = await request(API_URL).get(`/canyons/${id}`).set(AUTH);
    expect(afterRes.status).toBe(404);

    // The canyon-scoped trips list 404s because the canyon no longer exists.
    const tripsAfter = await request(API_URL)
      .get(`/canyons/${id}/trips`)
      .set(AUTH);
    expect([403, 404]).toContain(tripsAfter.status);

    // But the trip itself SURVIVES, detached: it appears in the global trip
    // list with no linked canyons and the deleted canyon's name backfilled
    // onto displayName (it was null and this was its only linked canyon) so
    // it still carries a label.
    const survivorRes = await request(API_URL).get(`/trips/${tripId}`).set(AUTH);
    expect(survivorRes.status).toBe(200);
    expect(survivorRes.body.canyons).toEqual([]);
    expect(survivorRes.body.displayName).toBe(canyonName);

    // Clean up the orphaned trip (no canyon left to cascade it away).
    await request(API_URL).delete(`/trips/${tripId}`).set(AUTH);
  });

  it("DELETE /canyons/:id on one of a trip's TWO linked canyons keeps the trip AND the survivor; displayName stays null", async () => {
    const canyonAName = "CH-003 detach-partial A";
    const canyonBName = "CH-003 detach-partial B";
    const canyonAId = await createCanyon(canyonAName);
    const canyonBId = await createCanyon(canyonBName);

    const tripRes = await request(API_URL)
      .post("/trips")
      .set(AUTH)
      .send({ canyonIds: [canyonAId, canyonBId], date: "2024-05-02" });
    expect(tripRes.status).toBe(201);
    const tripId = tripRes.body.id as string;

    try {
      const delRes = await request(API_URL).delete(`/canyons/${canyonAId}`).set(AUTH);
      expect(delRes.status).toBe(204);

      const survivorRes = await request(API_URL).get(`/trips/${tripId}`).set(AUTH);
      expect(survivorRes.status).toBe(200);
      // Only the surviving canyon remains linked; no backfill since the trip
      // still derives its title from the survivor.
      expect(survivorRes.body.canyons).toEqual([{ id: canyonBId, name: canyonBName }]);
      expect(survivorRes.body.displayName).toBeNull();
    } finally {
      await request(API_URL).delete(`/trips/${tripId}`).set(AUTH);
      await request(API_URL).delete(`/canyons/${canyonBId}`).set(AUTH);
    }
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

// APIR-010: `name`/`altNames`/`notes`/`attributes` were unvalidated, so a
// mistyped field passed validation and died inside Prisma as a raw 500 — and
// on the sync push path one such op poisoned every flush of that batch.
describe("POST /canyons — free-text field validation", () => {
  const AUTH_LOCAL = { Authorization: "Bearer fake-token" } as const;

  it("400s (never 500s) on mistyped name/altNames/notes/attributes", async () => {
    const bad: Record<string, unknown>[] = [
      { name: 123 },
      { name: "   " },
      { name: "x".repeat(201) },
      { name: "ok", altNames: "not-an-array" },
      { name: "ok", altNames: [1] },
      { name: "ok", notes: 7 },
      { name: "ok", attributes: [1, 2] },
    ];
    for (const fields of bad) {
      const res = await request(API_URL)
        .post("/canyons")
        .set(AUTH_LOCAL)
        .send({ latitude: -33.7, longitude: 150.3, ...fields });
      expect(res.status).toBe(400);
    }
  });
});

