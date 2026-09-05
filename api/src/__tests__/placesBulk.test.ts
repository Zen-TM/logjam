import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import prisma from "../services/prisma";
import { BOB_ID, NONEXISTENT_ID, CANYON_TYPE_ID} from "./_actors";

// Requires `make dev` running with AUTH_MODE=fake (requests = seeded alice).
// Tests that need a "foreign" place create one directly via Prisma owned by
// BOB_ID and clean it up afterwards, rather than leaning on bob's seeded
// places — so the fixture is independent of what the seed happens to hold.
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

describe("POST /places/bulk — import contract (fake auth = alice)", () => {
  it("creates valid rows and reports per-row errors for invalid ones", async () => {
    const run = Date.now();
    const goodName = `CH-002 bulk valid ${run}`;
    const res = await request(API_URL)
      .post("/places/bulk")
      .set(AUTH)
      .send({
        placeTypeId: CANYON_TYPE_ID, importBatchId: randomUUID(),
        rows: [
          { data: { name: goodName, latitude: -33.7, longitude: 150.3 }, resolution: { kind: "create" } },
          { data: { name: "", latitude: -33.7, longitude: 150.3 }, resolution: { kind: "create" } },
          { data: { name: `bad lat ${run}`, latitude: 999, longitude: 150.3 }, resolution: { kind: "create" } },
          { data: { name: `bad grade ${run}`, latitude: -33.7, longitude: 150.3, fieldValues: { v_grade: 99 } }, resolution: { kind: "create" } },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    // Messages carry NO "Row N:" prefix — the caller labels the row from the
    // returned rowIndex so it can use the original CSV line (IMPORT-7).
    // Numeric/coordinate messages now derive from the shared
    // PLACE_NUMERIC_CONSTRAINTS / range constants (single source of truth with
    // POST/PATCH /places) — labels are the shared field labels.
    expect(res.body.errors).toEqual([
      { rowIndex: 1, message: "name is required" },
      { rowIndex: 2, message: "latitude must be a number between -90 and 90" },
      { rowIndex: 3, message: "V grade must be between 1 and 7" },
    ]);

    const listRes = await request(API_URL).get("/places").set(AUTH);
    const created = listRes.body.find((c: { name: string }) => c.name === goodName);
    expect(created).toBeDefined();

    await request(API_URL).delete(`/places/${created.id}`).set(AUTH);
  });

  it("folds two identical create rows into one instead of 500ing on the unique constraint (IMPORT-1)", async () => {
    const name = `IMPORT-1 dup ${Date.now()}`;
    const dupRow = {
      data: { name, latitude: -33.7, longitude: 150.3 },
      resolution: { kind: "create" as const },
    };
    const res = await request(API_URL)
      .post("/places/bulk")
      .set(AUTH)
      .send({ placeTypeId: CANYON_TYPE_ID, importBatchId: randomUUID(), rows: [dupRow, dupRow] });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(res.body.errors).toEqual([]);

    const listRes = await request(API_URL).get("/places").set(AUTH);
    const matches = listRes.body.filter((c: { name: string }) => c.name === name);
    expect(matches).toHaveLength(1);
    await request(API_URL).delete(`/places/${matches[0].id}`).set(AUTH);
  });

  it("rejects an empty rows array with 400", async () => {
    const res = await request(API_URL)
      .post("/places/bulk")
      .set(AUTH)
      .send({ placeTypeId: CANYON_TYPE_ID, importBatchId: randomUUID(), rows: [] });
    expect(res.status).toBe(400);
  });

  it("merges into an owned place by resolution", async () => {
    const id = await createPlace(`CH-002 bulk merge target ${Date.now()}`);
    try {
      const res = await request(API_URL)
        .post("/places/bulk")
        .set(AUTH)
        .send({
          placeTypeId: CANYON_TYPE_ID, importBatchId: randomUUID(),
          rows: [
            {
              data: { name: "ignored — name is immutable on merge", latitude: -33.8, longitude: 150.4, notes: "merged in" },
              resolution: { kind: "merge", placeId: id },
            },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.merged).toBe(1);

      const getRes = await request(API_URL).get(`/places/${id}`).set(AUTH);
      expect(getRes.body.notes).toBe("merged in"); // null field filled
    } finally {
      await request(API_URL).delete(`/places/${id}`).set(AUTH);
    }
  });

  it("a merge row with a non-existent placeId is reported as a per-row error", async () => {
    const res = await request(API_URL)
      .post("/places/bulk")
      .set(AUTH)
      .send({
        placeTypeId: CANYON_TYPE_ID, importBatchId: randomUUID(),
        rows: [
          {
            data: { name: `CH-002 bulk nonexistent ${Date.now()}`, latitude: -33.7, longitude: 150.3 },
            resolution: { kind: "merge", placeId: NONEXISTENT_ID },
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(0);
    expect(res.body.merged).toBe(0);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].rowIndex).toBe(0);
  });

  it("rejects merging into a foreign-owned placeId as a per-row not-found error indistinguishable from a nonexistent id (no 403 oracle, no rows changed)", async () => {
    // Since 024f410 the merge-target lookup is owner-scoped: a target owned by
    // someone else is absent from the lookup and reported with the SAME per-row
    // "target place not found" error as a nonexistent id — a 403 here would
    // confirm to a non-owner that the place ID exists (existence oracle).
    const foreign = await prisma.place.create({
      data: {
        placeTypeId: CANYON_TYPE_ID,
        ownerId: BOB_ID,
        name: `CH-002 bob's place ${Date.now()}`,
        latitude: -33.5,
        longitude: 150.1,
      },
    });
    try {
      const res = await request(API_URL)
        .post("/places/bulk")
        .set(AUTH)
        .send({
          placeTypeId: CANYON_TYPE_ID, importBatchId: randomUUID(),
          rows: [
            {
              data: { name: "CH-002 hijacked", latitude: -33.7, longitude: 150.3, notes: "hijack" },
              resolution: { kind: "merge", placeId: foreign.id },
            },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.merged).toBe(0);
      expect(res.body.created).toBe(0);
      expect(res.body.errors).toHaveLength(1);
      expect(res.body.errors[0].rowIndex).toBe(0);
      // Same message shape as the nonexistent-id case — must not leak ownership.
      expect(res.body.errors[0].message).toContain("target place not found");

      const after = await prisma.place.findUnique({ where: { id: foreign.id } });
      expect(after?.notes).toBeNull();
    } finally {
      await prisma.place.delete({ where: { id: foreign.id } });
    }
  });

  it("does not 409 when a create row and a merge row compute the same importKey (IMPORT-1 partial-commit)", async () => {
    // A create row and a merge-into-existing row with identical name+coords
    // produce the same importKey. Creates commit first (un-transacted), so the
    // merge stamping the same (ownerId, importKey) would 409 AFTER the create
    // landed. The fix drops the merge's best-effort importKey stamp instead.
    const run = Date.now();
    const shared = `IMPORT-1 collide ${run}`;
    const mergeTargetId = await createPlace(`IMPORT-1 merge target ${run}`);
    try {
      const res = await request(API_URL)
        .post("/places/bulk")
        .set(AUTH)
        .send({
          placeTypeId: CANYON_TYPE_ID, importBatchId: randomUUID(),
          rows: [
            { data: { name: shared, latitude: -33.7, longitude: 150.3 }, resolution: { kind: "create" } },
            { data: { name: shared, latitude: -33.7, longitude: 150.3, notes: "merged" }, resolution: { kind: "merge", placeId: mergeTargetId } },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.created).toBe(1);
      expect(res.body.merged).toBe(1);
      expect(res.body.errors).toEqual([]);

      // The merge applied (null field filled) but did NOT steal the create's
      // importKey.
      const merged = await prisma.place.findUnique({ where: { id: mergeTargetId } });
      expect(merged?.notes).toBe("merged");
      expect(merged?.importKey).toBeNull();

      const listRes = await request(API_URL).get("/places").set(AUTH);
      const createdRow = listRes.body.find((c: { name: string }) => c.name === shared);
      expect(createdRow).toBeDefined();
      await request(API_URL).delete(`/places/${createdRow.id}`).set(AUTH);
    } finally {
      await request(API_URL).delete(`/places/${mergeTargetId}`).set(AUTH);
    }
  });
});

describe("POST /places/bulk/delete (fake auth = alice)", () => {
  it("deletes only owned places from a mixed owned/foreign id list", async () => {
    const ownedId = await createPlace("CH-002 bulk delete owned");
    const foreign = await prisma.place.create({
      data: {
        placeTypeId: CANYON_TYPE_ID,
        ownerId: BOB_ID,
        name: "CH-002 bulk delete foreign",
        latitude: -33.5,
        longitude: 150.1,
      },
    });
    try {
      const res = await request(API_URL)
        .post("/places/bulk/delete")
        .set(AUTH)
        .send({ ids: [ownedId, foreign.id] });
      expect(res.status).toBe(200);
      expect(res.body.deletedIds).toEqual([ownedId]);

      const ownedAfter = await request(API_URL).get(`/places/${ownedId}`).set(AUTH);
      expect(ownedAfter.status).toBe(404);

      const foreignAfter = await prisma.place.findUnique({ where: { id: foreign.id } });
      expect(foreignAfter).not.toBeNull();
    } finally {
      await prisma.place.deleteMany({ where: { id: foreign.id } });
    }
  });

  it("returns an empty deletedIds list when all ids are foreign-owned", async () => {
    const foreign = await prisma.place.create({
      data: {
        placeTypeId: CANYON_TYPE_ID,
        ownerId: BOB_ID,
        name: "CH-002 bulk delete all-foreign",
        latitude: -33.5,
        longitude: 150.1,
      },
    });
    try {
      const res = await request(API_URL)
        .post("/places/bulk/delete")
        .set(AUTH)
        .send({ ids: [foreign.id] });
      expect(res.status).toBe(200);
      expect(res.body.deletedIds).toEqual([]);

      const foreignAfter = await prisma.place.findUnique({ where: { id: foreign.id } });
      expect(foreignAfter).not.toBeNull();
    } finally {
      await prisma.place.deleteMany({ where: { id: foreign.id } });
    }
  });

  it("rejects an empty ids array with 400", async () => {
    const res = await request(API_URL)
      .post("/places/bulk/delete")
      .set(AUTH)
      .send({ ids: [] });
    expect(res.status).toBe(400);
  });

  it("rejects more than 500 ids with 413", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `id-${i}`);
    const res = await request(API_URL)
      .post("/places/bulk/delete")
      .set(AUTH)
      .send({ ids });
    expect(res.status).toBe(413);
  });

  it("bulk-deleting BOTH places of a 2-place trip keeps the trip and backfills displayName with the joined names", async () => {
    const nameA = "CH-002 bulk backfill A";
    const nameB = "CH-002 bulk backfill B";
    const placeAId = await createPlace(nameA);
    const placeBId = await createPlace(nameB);

    const tripRes = await request(API_URL)
      .post("/trips")
      .set(AUTH)
      .send({ placeIds: [placeAId, placeBId], date: "2024-05-03" });
    expect(tripRes.status).toBe(201);
    const tripId = tripRes.body.id as string;

    try {
      const res = await request(API_URL)
        .post("/places/bulk/delete")
        .set(AUTH)
        .send({ ids: [placeAId, placeBId] });
      expect(res.status).toBe(200);
      expect(res.body.deletedIds.sort()).toEqual([placeAId, placeBId].sort());

      const survivorRes = await request(API_URL).get(`/trips/${tripId}`).set(AUTH);
      expect(survivorRes.status).toBe(200);
      expect(survivorRes.body.places).toEqual([]);
      // formatTripPlaceNames join, in the original join-position order.
      expect(survivorRes.body.displayName).toBe(`${nameA} and ${nameB}`);
    } finally {
      await request(API_URL).delete(`/trips/${tripId}`).set(AUTH);
    }
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
