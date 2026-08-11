import { describe, it, expect } from "vitest";
import request from "supertest";
import {
  API_URL,
  ALICE_SUB,
  BOB_SUB,
  CAROL_SUB,
  SHARED_CANYON_ID,
  as,
} from "./_actors";

// The delta endpoint requires the client-version header (the forced-upgrade
// lever reads it), so a sync request without one is a 400 before it ever
// reaches the visibility logic under test here.
const CLIENT = { "x-logjam-client": "mobile/0.1.0-test" } as const;

// Waypoint CRUD + share/ownership boundary. An UNLINKED waypoint is
// owner-private (non-owners get 404, never 403 — SEC-001 anti-oracle); one
// linked to a shared canyon is visible to that canyon's sharees, read-only,
// and an owner-only mutation they attempt is 403 rather than 404.
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
        canyonIds: ["00000000-0000-4000-8000-000000000000"],
      });
    // Same 400 for nonexistent and foreign ids (owner-scoped lookup).
    expect(res.status).toBe(400);
  });

  it("round-trips tags and canyon links", async () => {
    const res = await request(API_URL)
      .post("/waypoints")
      .set(as(ALICE_SUB))
      .send({
        name: "Trailhead carpark",
        latitude: -33.65,
        longitude: 150.25,
        tags: ["carpark", "Water"],
        canyonIds: [SHARED_CANYON_ID],
      });
    expect(res.status).toBe(201);
    expect(res.body.tags).toEqual(["carpark", "Water"]);
    expect(res.body.canyonIds).toEqual([SHARED_CANYON_ID]);
    expect(res.body.syncRole).toBe("owner");

    // null empties both lists; undefined would have left them alone.
    const cleared = await request(API_URL)
      .patch(`/waypoints/${res.body.id as string}`)
      .set(as(ALICE_SUB))
      .send({ tags: null, canyonIds: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.tags).toEqual([]);
    expect(cleared.body.canyonIds).toEqual([]);

    await request(API_URL)
      .delete(`/waypoints/${res.body.id as string}`)
      .set(as(ALICE_SUB));
  });

  it("rejects duplicate tags case-insensitively", async () => {
    const res = await request(API_URL)
      .post("/waypoints")
      .set(as(ALICE_SUB))
      .send({
        name: "x",
        latitude: -33.65,
        longitude: 150.25,
        tags: ["Carpark", "carpark"],
      });
    expect(res.status).toBe(400);
  });
});

describe("waypoints share boundary", () => {
  // A waypoint LINKED to a shared canyon is part of that shared record (the
  // same visibility canyon-level media and linked routes have). Everything
  // below is the recipient's perspective, which mocked-Prisma unit tests
  // cannot reach.
  async function linkedWaypoint(): Promise<string> {
    const res = await request(API_URL)
      .post("/waypoints")
      .set(as(ALICE_SUB))
      .send({
        name: "Shared carpark",
        latitude: -33.67,
        longitude: 150.27,
        canyonIds: [SHARED_CANYON_ID],
      });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  it("a sharee sees a linked waypoint, read-only", async () => {
    const id = await linkedWaypoint();

    const read = await request(API_URL)
      .get(`/waypoints/${id}`)
      .set(as(BOB_SUB));
    expect(read.status).toBe(200);
    expect(read.body.syncRole).toBe("shared");

    const list = await request(API_URL).get("/waypoints").set(as(BOB_SUB));
    expect(list.body.some((w: { id: string }) => w.id === id)).toBe(true);

    // 403 not 404: bob legitimately sees this row, he just cannot change it.
    const patch = await request(API_URL)
      .patch(`/waypoints/${id}`)
      .set(as(BOB_SUB))
      .send({ name: "hijack" });
    expect(patch.status).toBe(403);

    const del = await request(API_URL).delete(`/waypoints/${id}`).set(as(BOB_SUB));
    expect(del.status).toBe(403);

    await request(API_URL).delete(`/waypoints/${id}`).set(as(ALICE_SUB));
  });

  it("a stranger gets 404 on a waypoint shared with someone else", async () => {
    const id = await linkedWaypoint();

    // Carol is shared nothing — the status must not confirm the id exists.
    const read = await request(API_URL)
      .get(`/waypoints/${id}`)
      .set(as(CAROL_SUB));
    expect(read.status).toBe(404);
    const patch = await request(API_URL)
      .patch(`/waypoints/${id}`)
      .set(as(CAROL_SUB))
      .send({ name: "hijack" });
    expect(patch.status).toBe(404);

    await request(API_URL).delete(`/waypoints/${id}`).set(as(ALICE_SUB));
  });

  it("scopes canyonIds to what the recipient may see", async () => {
    // Alice files one carpark under a canyon bob has, and one he does not.
    const privateCanyon = await request(API_URL)
      .post("/canyons")
      .set(as(ALICE_SUB))
      .send({ name: "Unshared canyon", latitude: -33.68, longitude: 150.28 });
    expect(privateCanyon.status).toBe(201);

    const created = await request(API_URL)
      .post("/waypoints")
      .set(as(ALICE_SUB))
      .send({
        name: "Two-canyon carpark",
        latitude: -33.67,
        longitude: 150.27,
        canyonIds: [SHARED_CANYON_ID, privateCanyon.body.id],
      });
    expect(created.status).toBe(201);
    expect(created.body.canyonIds).toHaveLength(2);

    // Bob learns only about the canyon he was actually shared on — the link
    // list must not leak the existence of the other one.
    const read = await request(API_URL)
      .get(`/waypoints/${created.body.id as string}`)
      .set(as(BOB_SUB));
    expect(read.status).toBe(200);
    expect(read.body.canyonIds).toEqual([SHARED_CANYON_ID]);

    await request(API_URL)
      .delete(`/waypoints/${created.body.id as string}`)
      .set(as(ALICE_SUB));
    await request(API_URL)
      .delete(`/canyons/${privateCanyon.body.id as string}`)
      .set(as(ALICE_SUB));
  });

  it("unlinking the last shared canyon tombstones the sharee", async () => {
    const id = await linkedWaypoint();

    const before = await request(API_URL)
      .get("/sync/delta")
      .set({ ...as(BOB_SUB), ...CLIENT })
      .query({ limit: 500 });
    expect(before.status).toBe(200);
    const cursor = before.body.cursor as string;

    const unlink = await request(API_URL)
      .patch(`/waypoints/${id}`)
      .set(as(ALICE_SUB))
      .send({ canyonIds: [] });
    expect(unlink.status).toBe(200);

    // The row is still very much alive for alice — but bob must be told to
    // drop it, or the coordinate stays on his device forever.
    const after = await request(API_URL)
      .get("/sync/delta")
      .set({ ...as(BOB_SUB), ...CLIENT })
      .query({ cursor });
    expect(after.status).toBe(200);
    expect(
      // Top-level, not under `changes` — a tombstone is not a change to a row,
      // it is an instruction to forget one.
      after.body.tombstones.some(
        (t: { type: string; id: string }) =>
          t.type === "waypoint" && t.id === id,
      ),
    ).toBe(true);

    await request(API_URL).delete(`/waypoints/${id}`).set(as(ALICE_SUB));
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
