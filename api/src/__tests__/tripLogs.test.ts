import { describe, it, expect } from "vitest";
import request from "supertest";

// Coverage for routes/tripLogs.ts — the nested /canyons/:canyonId/trips
// router. The trip↔canyon m2m cutover removed every nested route except the
// list GET (a filtered convenience view over the global /trips list); nested
// POST/PATCH/DELETE and the nested single-trip GET no longer exist — a
// request to any of them now 404s (Express's default no-route-matched
// handler, since the router only registers `GET /`). Single-trip
// fetch/create/update/delete now lives entirely on the global /trips surface
// — see tripLogsGlobal.test.ts.
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

async function createTrip(canyonIds: string[], date: string): Promise<string> {
  const res = await request(API_URL)
    .post("/trips")
    .set(AUTH)
    .send({ canyonIds, date });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function cleanup(canyonId: string, tripId?: string): Promise<void> {
  if (tripId) await request(API_URL).delete(`/trips/${tripId}`).set(AUTH);
  await request(API_URL).delete(`/canyons/${canyonId}`).set(AUTH);
}

describe("GET /canyons/:canyonId/trips (nested list, fake auth = alice)", () => {
  it("owner sees own trips linked to the canyon, with canyons[] populated in join order", async () => {
    const canyonId = await createCanyon("tripLogs nested list owner");
    let tripId: string | undefined;
    try {
      tripId = await createTrip([canyonId], "2026-06-01");

      const res = await request(API_URL)
        .get(`/canyons/${canyonId}/trips`)
        .set(AUTH);
      expect(res.status).toBe(200);
      const trip = (res.body as Array<Record<string, unknown>>).find(
        (t) => t.id === tripId,
      );
      expect(trip).toBeDefined();
      expect(trip!.canyons).toEqual([
        { id: canyonId, name: "tripLogs nested list owner" },
      ]);
      // Old single-canyon shape is fully gone from the wire.
      expect(trip!.canyon).toBeUndefined();
      expect(trip!.canyonId).toBeUndefined();
    } finally {
      await cleanup(canyonId, tripId);
    }
  });

  it("404s for a non-existent canyon id", async () => {
    const res = await request(API_URL)
      .get(`/canyons/${NONEXISTENT_ID}/trips`)
      .set(AUTH);
    expect(res.status).toBe(404);
  });
});

describe("removed nested mutation + single-GET routes now 404", () => {
  it("POST /canyons/:canyonId/trips 404s (creation moved to global POST /trips)", async () => {
    const canyonId = await createCanyon("tripLogs nested POST removed");
    try {
      const res = await request(API_URL)
        .post(`/canyons/${canyonId}/trips`)
        .set(AUTH)
        .send({ date: "2026-06-01" });
      expect(res.status).toBe(404);
    } finally {
      await cleanup(canyonId);
    }
  });

  it("PATCH /canyons/:canyonId/trips/:id 404s (updates moved to global PATCH /trips/:id)", async () => {
    const canyonId = await createCanyon("tripLogs nested PATCH removed");
    let tripId: string | undefined;
    try {
      tripId = await createTrip([canyonId], "2026-06-01");
      const res = await request(API_URL)
        .patch(`/canyons/${canyonId}/trips/${tripId}`)
        .set(AUTH)
        .send({ notes: "x" });
      expect(res.status).toBe(404);
    } finally {
      await cleanup(canyonId, tripId);
    }
  });

  it("DELETE /canyons/:canyonId/trips/:id 404s (deletes moved to global DELETE /trips/:id)", async () => {
    const canyonId = await createCanyon("tripLogs nested DELETE removed");
    let tripId: string | undefined;
    try {
      tripId = await createTrip([canyonId], "2026-06-01");
      const res = await request(API_URL)
        .delete(`/canyons/${canyonId}/trips/${tripId}`)
        .set(AUTH);
      expect(res.status).toBe(404);
    } finally {
      await cleanup(canyonId, tripId);
    }
  });

  it("GET /canyons/:canyonId/trips/:id (single, nested) 404s — superseded by GET /trips/:id", async () => {
    const canyonId = await createCanyon("tripLogs nested single-GET removed");
    let tripId: string | undefined;
    try {
      tripId = await createTrip([canyonId], "2026-06-01");
      const res = await request(API_URL)
        .get(`/canyons/${canyonId}/trips/${tripId}`)
        .set(AUTH);
      expect(res.status).toBe(404);
    } finally {
      await cleanup(canyonId, tripId);
    }
  });
});
