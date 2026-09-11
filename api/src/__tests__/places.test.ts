import { describe, it, expect } from "vitest";
import request from "supertest";
import { BOB_ID, NONEXISTENT_ID, CANYON_TYPE_ID} from "./_actors";

// Requires `make dev` to be running (Postgres + MiniStack + API on :8080) with
// AUTH_MODE=fake (every request authenticates as the seeded alice user).
//
// These tests create their own places and delete them again, so they do not
// mutate the baseline seed (5 alice places, 2 shared with bob).
const API_URL = process.env.API_URL ?? "http://localhost:8080";
const AUTH = { Authorization: "Bearer fake-token" } as const;

async function createPlace(name: string): Promise<string> {
  const res = await request(API_URL)
    .post("/places")
    .set(AUTH)
    .send({ placeTypeId: CANYON_TYPE_ID, name, latitude: -33.7, longitude: 150.3 });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("places routes (fake auth = alice)", () => {
  it("GET /places returns the owner's places", async () => {
    const res = await request(API_URL).get("/places").set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Seed gives alice 5 places; she owns at least those.
    expect(res.body.length).toBeGreaterThanOrEqual(5);
  });

  it("POST /places rejects a body missing required fields", async () => {
    const res = await request(API_URL)
      .post("/places")
      .set(AUTH)
      .send({ placeTypeId: CANYON_TYPE_ID, name: "No coords" });
    expect(res.status).toBe(400);
  });

  it("GET /places/:id returns owned place with trip logs and media arrays", async () => {
    const id = await createPlace("CH-003 detail test");
    try {
      const res = await request(API_URL).get(`/places/${id}`).set(AUTH);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(id);
      // Owner view exposes the trip log list and media array.
      expect(Array.isArray(res.body.tripLogs)).toBe(true);
      expect(Array.isArray(res.body.media)).toBe(true);
    } finally {
      await request(API_URL).delete(`/places/${id}`).set(AUTH);
    }
  });

  it("GET /places/:id returns 404 for a non-existent place", async () => {
    const res = await request(API_URL)
      .get(`/places/${NONEXISTENT_ID}`)
      .set(AUTH);
    expect(res.status).toBe(404);
  });

  it("DELETE /places/:id detaches its sole-linked trip log (keeps it, backfills displayName) then removes the place", async () => {
    const placeName = "CH-003 detach test";
    const id = await createPlace(placeName);

    // Attach a trip log so we exercise the detach path (creation moved to the
    // global POST /trips surface — the nested POST was removed).
    const tripRes = await request(API_URL)
      .post("/trips")
      .set(AUTH)
      .send({ placeIds: [id], date: "2024-05-01", notes: "detach trip" });
    expect(tripRes.status).toBe(201);
    const tripId = tripRes.body.id as string;
    expect(tripRes.body.displayName).toBeNull();

    const delRes = await request(API_URL).delete(`/places/${id}`).set(AUTH);
    expect(delRes.status).toBe(204);

    // Place is gone.
    const afterRes = await request(API_URL).get(`/places/${id}`).set(AUTH);
    expect(afterRes.status).toBe(404);

    // The place-scoped trips list 404s because the place no longer exists.
    const tripsAfter = await request(API_URL)
      .get(`/places/${id}/trips`)
      .set(AUTH);
    expect([403, 404]).toContain(tripsAfter.status);

    // But the trip itself SURVIVES, detached: it appears in the global trip
    // list with no linked places and the deleted place's name backfilled
    // onto displayName (it was null and this was its only linked place) so
    // it still carries a label.
    const survivorRes = await request(API_URL).get(`/trips/${tripId}`).set(AUTH);
    expect(survivorRes.status).toBe(200);
    expect(survivorRes.body.places).toEqual([]);
    expect(survivorRes.body.displayName).toBe(placeName);

    // Clean up the orphaned trip (no place left to cascade it away).
    await request(API_URL).delete(`/trips/${tripId}`).set(AUTH);
  });

  it("DELETE /places/:id on one of a trip's TWO linked places keeps the trip AND the survivor; displayName stays null", async () => {
    const placeAName = "CH-003 detach-partial A";
    const placeBName = "CH-003 detach-partial B";
    const placeAId = await createPlace(placeAName);
    const placeBId = await createPlace(placeBName);

    const tripRes = await request(API_URL)
      .post("/trips")
      .set(AUTH)
      .send({ placeIds: [placeAId, placeBId], date: "2024-05-02" });
    expect(tripRes.status).toBe(201);
    const tripId = tripRes.body.id as string;

    try {
      const delRes = await request(API_URL).delete(`/places/${placeAId}`).set(AUTH);
      expect(delRes.status).toBe(204);

      const survivorRes = await request(API_URL).get(`/trips/${tripId}`).set(AUTH);
      expect(survivorRes.status).toBe(200);
      // Only the surviving place remains linked; no backfill since the trip
      // still derives its title from the survivor.
      expect(survivorRes.body.places).toEqual([{ id: placeBId, name: placeBName }]);
      expect(survivorRes.body.displayName).toBeNull();
    } finally {
      await request(API_URL).delete(`/trips/${tripId}`).set(AUTH);
      await request(API_URL).delete(`/places/${placeBId}`).set(AUTH);
    }
  });

  it("POST /places/:id/copy forks an accessible place under the caller", async () => {
    const id = await createPlace("CH-003 copy source");
    let copyId: string | undefined;
    try {
      const copyRes = await request(API_URL)
        .post(`/places/${id}/copy`)
        .set(AUTH)
        .send({});
      expect(copyRes.status).toBe(201);
      copyId = copyRes.body.id as string;
      expect(copyId).not.toBe(id);
      expect(copyRes.body.forkedFromId).toBe(id);
    } finally {
      if (copyId) await request(API_URL).delete(`/places/${copyId}`).set(AUTH);
      await request(API_URL).delete(`/places/${id}`).set(AUTH);
    }
  });

  it("GET /places/shared lists places shared WITH alice (none in baseline seed)", async () => {
    // Baseline: alice is the sharer, not a recipient, so her shared list is
    // empty. Share one of her own places with bob and confirm it does NOT
    // appear in alice's own shared list (she is the owner, not the recipient).
    const id = await createPlace("CH-003 shared list test");
    try {
      const shareRes = await request(API_URL)
        .post(`/places/${id}/share`)
        .set(AUTH)
        .send({ sharedWithUserId: BOB_ID });
      expect(shareRes.status).toBe(201);

      const sharedRes = await request(API_URL)
        .get("/places/shared")
        .set(AUTH);
      expect(sharedRes.status).toBe(200);
      expect(
        sharedRes.body.some((c: { id: string }) => c.id === id),
      ).toBe(false);
    } finally {
      await request(API_URL).delete(`/places/${id}`).set(AUTH);
    }
  });
});

// APIR-010: `name`/`altNames`/`notes`/`attributes` were unvalidated, so a
// mistyped field passed validation and died inside Prisma as a raw 500 — and
// on the sync push path one such op poisoned every flush of that batch.
describe("POST /places — free-text field validation", () => {
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
        .post("/places")
        .set(AUTH_LOCAL)
        .send({ placeTypeId: CANYON_TYPE_ID, latitude: -33.7, longitude: 150.3, ...fields });
      expect(res.status).toBe(400);
    }
  });
});

