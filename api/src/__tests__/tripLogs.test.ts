import { describe, it, expect } from "vitest";
import request from "supertest";

// Coverage for routes/tripLogs.ts — the nested /places/:placeId/trips
// router. The trip↔place m2m cutover removed every nested route except the
// list GET (a filtered convenience view over the global /trips list); nested
// POST/PATCH/DELETE and the nested single-trip GET no longer exist — a
// request to any of them now 404s (Express's default no-route-matched
// handler, since the router only registers `GET /`). Single-trip
// fetch/create/update/delete now lives entirely on the global /trips surface
// — see tripLogsGlobal.test.ts.
const API_URL = process.env.API_URL ?? "http://localhost:8080";
const AUTH = { Authorization: "Bearer fake-token" } as const;

const NONEXISTENT_ID = "99999999-9999-9999-9999-999999999999";

async function createPlace(name: string): Promise<string> {
  const res = await request(API_URL)
    .post("/places")
    .set(AUTH)
    .send({ name, latitude: -33.7, longitude: 150.3 });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function createTrip(placeIds: string[], date: string): Promise<string> {
  const res = await request(API_URL)
    .post("/trips")
    .set(AUTH)
    .send({ placeIds, date });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function cleanup(placeId: string, tripId?: string): Promise<void> {
  if (tripId) await request(API_URL).delete(`/trips/${tripId}`).set(AUTH);
  await request(API_URL).delete(`/places/${placeId}`).set(AUTH);
}

describe("GET /places/:placeId/trips (nested list, fake auth = alice)", () => {
  it("owner sees own trips linked to the place, with places[] populated in join order", async () => {
    const placeId = await createPlace("tripLogs nested list owner");
    let tripId: string | undefined;
    try {
      tripId = await createTrip([placeId], "2026-06-01");

      const res = await request(API_URL)
        .get(`/places/${placeId}/trips`)
        .set(AUTH);
      expect(res.status).toBe(200);
      const trip = (res.body as Array<Record<string, unknown>>).find(
        (t) => t.id === tripId,
      );
      expect(trip).toBeDefined();
      expect(trip!.places).toEqual([
        { id: placeId, name: "tripLogs nested list owner" },
      ]);
      // Old single-place shape is fully gone from the wire.
      expect(trip!.place).toBeUndefined();
      expect(trip!.placeId).toBeUndefined();
    } finally {
      await cleanup(placeId, tripId);
    }
  });

  it("404s for a non-existent place id", async () => {
    const res = await request(API_URL)
      .get(`/places/${NONEXISTENT_ID}/trips`)
      .set(AUTH);
    expect(res.status).toBe(404);
  });
});

describe("removed nested mutation + single-GET routes now 404", () => {
  it("POST /places/:placeId/trips 404s (creation moved to global POST /trips)", async () => {
    const placeId = await createPlace("tripLogs nested POST removed");
    try {
      const res = await request(API_URL)
        .post(`/places/${placeId}/trips`)
        .set(AUTH)
        .send({ date: "2026-06-01" });
      expect(res.status).toBe(404);
    } finally {
      await cleanup(placeId);
    }
  });

  it("PATCH /places/:placeId/trips/:id 404s (updates moved to global PATCH /trips/:id)", async () => {
    const placeId = await createPlace("tripLogs nested PATCH removed");
    let tripId: string | undefined;
    try {
      tripId = await createTrip([placeId], "2026-06-01");
      const res = await request(API_URL)
        .patch(`/places/${placeId}/trips/${tripId}`)
        .set(AUTH)
        .send({ notes: "x" });
      expect(res.status).toBe(404);
    } finally {
      await cleanup(placeId, tripId);
    }
  });

  it("DELETE /places/:placeId/trips/:id 404s (deletes moved to global DELETE /trips/:id)", async () => {
    const placeId = await createPlace("tripLogs nested DELETE removed");
    let tripId: string | undefined;
    try {
      tripId = await createTrip([placeId], "2026-06-01");
      const res = await request(API_URL)
        .delete(`/places/${placeId}/trips/${tripId}`)
        .set(AUTH);
      expect(res.status).toBe(404);
    } finally {
      await cleanup(placeId, tripId);
    }
  });

  it("GET /places/:placeId/trips/:id (single, nested) 404s — superseded by GET /trips/:id", async () => {
    const placeId = await createPlace("tripLogs nested single-GET removed");
    let tripId: string | undefined;
    try {
      tripId = await createTrip([placeId], "2026-06-01");
      const res = await request(API_URL)
        .get(`/places/${placeId}/trips/${tripId}`)
        .set(AUTH);
      expect(res.status).toBe(404);
    } finally {
      await cleanup(placeId, tripId);
    }
  });
});
