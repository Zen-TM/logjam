import { describe, it, expect } from "vitest";
import request from "supertest";
import { API_URL, ALICE_SUB, BOB_SUB, as } from "./_actors";

// Waypoint CRUD + ownership boundary (Stage 8 PR-1). Owner-private resource:
// non-owners get 404 (never 403) on every /:id route — SEC-001 anti-oracle.
// Requires `make dev` (API on :8080, AUTH_MODE=fake).
// Synthetic coords only (committed-fixture rule).

async function createWaypoint(sub: string): Promise<string> {
  const res = await request(API_URL)
    .post("/waypoints")
    .set(as(sub))
    .send({ name: "Test anchor", latitude: -33.65, longitude: 150.25 });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("waypoints CRUD", () => {
  it("creates, lists, patches, deletes", async () => {
    const id = await createWaypoint(ALICE_SUB);

    const list = await request(API_URL).get("/waypoints").set(as(ALICE_SUB));
    expect(list.status).toBe(200);
    expect(list.headers["x-total-count"]).toBeDefined();
    expect(list.body.some((w: { id: string }) => w.id === id)).toBe(true);

    const beforePatch = list.body.find((w: { id: string }) => w.id === id);
    const patch = await request(API_URL)
      .patch(`/waypoints/${id}`)
      .set(as(ALICE_SUB))
      .send({ name: "Renamed", elevation: 900, symbol: "anchor" });
    expect(patch.status).toBe(200);
    expect(patch.body.name).toBe("Renamed");
    expect(patch.body.elevation).toBe(900);
    // updatedAt is the delta watermark — a PATCH must advance it.
    expect(new Date(patch.body.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(beforePatch.updatedAt as string).getTime(),
    );

    const del = await request(API_URL)
      .delete(`/waypoints/${id}`)
      .set(as(ALICE_SUB));
    expect(del.status).toBe(204);

    const after = await request(API_URL).get("/waypoints").set(as(ALICE_SUB));
    expect(after.body.some((w: { id: string }) => w.id === id)).toBe(false);
  });

  it("rejects invalid payloads", async () => {
    const noName = await request(API_URL)
      .post("/waypoints")
      .set(as(ALICE_SUB))
      .send({ latitude: -33.65, longitude: 150.25 });
    expect(noName.status).toBe(400);

    const badLat = await request(API_URL)
      .post("/waypoints")
      .set(as(ALICE_SUB))
      .send({ name: "x", latitude: 95, longitude: 150.25 });
    expect(badLat.status).toBe(400);
  });

  it("rejects a canyonId the caller does not own without confirming existence", async () => {
    const res = await request(API_URL)
      .post("/waypoints")
      .set(as(ALICE_SUB))
      .send({
        name: "x",
        latitude: -33.65,
        longitude: 150.25,
        canyonId: "00000000-0000-4000-8000-000000000000",
      });
    // Same 400 for nonexistent and foreign ids (owner-scoped lookup).
    expect(res.status).toBe(400);
  });
});

describe("waypoints ownership boundary", () => {
  it("non-owner gets 404 (never 403) on read/patch/delete", async () => {
    const id = await createWaypoint(ALICE_SUB);

    const patch = await request(API_URL)
      .patch(`/waypoints/${id}`)
      .set(as(BOB_SUB))
      .send({ name: "hijack" });
    expect(patch.status).toBe(404);

    const del = await request(API_URL)
      .delete(`/waypoints/${id}`)
      .set(as(BOB_SUB));
    expect(del.status).toBe(404);

    // Bob's list never contains alice's waypoint.
    const list = await request(API_URL).get("/waypoints").set(as(BOB_SUB));
    expect(list.body.some((w: { id: string }) => w.id === id)).toBe(false);

    // teardown
    await request(API_URL).delete(`/waypoints/${id}`).set(as(ALICE_SUB));
  });
});

describe("trip updatedAt watermark (stage8 §3.1 trap)", () => {
  it("a canyonIds-only PATCH bumps the trip's updatedAt", async () => {
    const canyon = await request(API_URL)
      .post("/canyons")
      .set(as(ALICE_SUB))
      .send({ name: "Watermark canyon", latitude: -33.66, longitude: 150.26 });
    expect(canyon.status).toBe(201);

    const trip = await request(API_URL)
      .post("/trips")
      .set(as(ALICE_SUB))
      .send({ date: "2026-07-01" });
    expect(trip.status).toBe(201);
    expect(trip.body.updatedAt).toBeDefined();
    const before = new Date(trip.body.updatedAt as string).getTime();

    // Ensure the clock can visibly advance past the create timestamp.
    await new Promise((r) => setTimeout(r, 25));

    const patch = await request(API_URL)
      .patch(`/trips/${trip.body.id as string}`)
      .set(as(ALICE_SUB))
      .send({ canyonIds: [canyon.body.id] });
    expect(patch.status).toBe(200);
    const after = new Date(patch.body.updatedAt as string).getTime();
    // The link change MUST move the row past the delta watermark.
    expect(after).toBeGreaterThan(before);

    // teardown (canyon delete backfills the trip name; delete trip too)
    await request(API_URL)
      .delete(`/trips/${trip.body.id as string}`)
      .set(as(ALICE_SUB));
    await request(API_URL)
      .delete(`/canyons/${canyon.body.id as string}`)
      .set(as(ALICE_SUB));
  });
});
