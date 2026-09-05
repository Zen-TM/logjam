import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import prisma from "../services/prisma";
import { ALICE_ID } from "./_actors";

// Idempotent file-import endpoints (see plan §6b/§6c, §8).
// Requires `make dev` running with AUTH_MODE=fake (requests = seeded alice).
// Place importKeys derive from name+coords, so each test uses a unique run
// suffix to avoid colliding with rows left by earlier runs.
const API_URL = process.env.API_URL ?? "http://localhost:8080";
const AUTH = { Authorization: "Bearer fake-token" } as const;

// Track every batch we create so afterAll can undo them even if a test throws.
const batches: string[] = [];

function newBatch(): string {
  const id = randomUUID();
  batches.push(id);
  return id;
}

function placeRow(
  name: string,
  latitude: number,
  longitude: number,
  extra: Record<string, unknown> = {},
) {
  return {
    data: { name, latitude, longitude, ...extra },
    resolution: { kind: "create" as const },
  };
}

describe("POST /places/bulk — idempotent import (fake auth = alice)", () => {
  it("re-importing the same place file is a no-op (no duplicate rows)", async () => {
    const run = Date.now();
    const name = `IMP place idempotent ${run}`;
    const batchId = newBatch();
    const body = {
      importBatchId: batchId,
      rows: [placeRow(name, -33.71, 150.31)],
    };

    const first = await request(API_URL).post("/places/bulk").set(AUTH).send(body);
    expect(first.status).toBe(200);
    expect(first.body.created).toBe(1);

    // Same payload, fresh batch id — importKey is derived from name+coords, so
    // the second run must merge into the existing row, not create a duplicate.
    const second = await request(API_URL)
      .post("/places/bulk")
      .set(AUTH)
      .send({ ...body, importBatchId: newBatch() });
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(0);

    const rows = await prisma.place.findMany({
      where: { ownerId: ALICE_ID, name },
    });
    expect(rows).toHaveLength(1);
  });

  it("respects mergePolicy on a conflicting field and unions null fields", async () => {
    const run = Date.now();
    // A pre-existing, manually-created place (no importKey, not batch-stamped).
    const created = await request(API_URL)
      .post("/places")
      .set(AUTH)
      .send({ name: `IMP merge target ${run}`, latitude: -33.72, longitude: 150.32, vGrade: 2 });
    expect(created.status).toBe(201);
    const placeId = created.body.id as string;

    const batchId = newBatch();
    const res = await request(API_URL)
      .post("/places/bulk")
      .set(AUTH)
      .send({
        importBatchId: batchId,
        // keepExisting on vGrade (conflict → keep 2); notes is null on the
        // existing row so the incoming value fills it regardless of policy.
        mergePolicy: undefined,
        rows: [
          {
            data: {
              name: `IMP merge target ${run}`,
              latitude: -33.72,
              longitude: 150.32,
              vGrade: 5,
              notes: "from import",
            },
            resolution: { kind: "merge", placeId },
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.merged).toBe(1);

    const after = await prisma.place.findUnique({ where: { id: placeId } });
    expect(after?.vGrade).toBe(2); // default policy keeps existing
    expect(after?.notes).toBe("from import"); // null filled, no data lost
    // Merged-into pre-existing row must NOT be batch-stamped (so undo spares it).
    expect(after?.importBatchId).toBeNull();
  });
});

describe("POST /trips/bulk — idempotent import (fake auth = alice)", () => {
  it("keeps same-place-same-day repeats as distinct rows; re-import does not grow", async () => {
    const run = Date.now();
    const sourcePlaceName = `IMP trip src ${run}`;
    const date = "2024-03-15";
    const batchId = newBatch();
    // The frontend sets displayName = sourcePlaceName for a place-less row
    // (plan §7a); the backend stores what it's given, so mirror that here.
    const trips = [
      { placeId: null, sourcePlaceName, displayName: sourcePlaceName, date, notes: "lap 1" },
      { placeId: null, sourcePlaceName, displayName: sourcePlaceName, date, notes: "lap 1" }, // identical → occurrence 1
    ];

    const first = await request(API_URL)
      .post("/trips/bulk")
      .set(AUTH)
      .send({ importBatchId: batchId, trips });
    expect(first.status).toBe(200);
    expect(first.body.imported).toBe(2); // both kept (occurrence differs)

    const reimport = await request(API_URL)
      .post("/trips/bulk")
      .set(AUTH)
      .send({ importBatchId: newBatch(), trips });
    expect(reimport.status).toBe(200);
    expect(reimport.body.imported).toBe(0);
    expect(reimport.body.updated).toBe(2);

    const rows = await prisma.tripLog.findMany({
      where: { userId: ALICE_ID, displayName: sourcePlaceName },
    });
    expect(rows).toHaveLength(2);
  });

  it("regression: keying on sourcePlaceName (not placeId) survives resolution change", async () => {
    const run = Date.now();
    const sourcePlaceName = `IMP phantom ${run}`;
    const date = "2024-04-01";

    // 1) Import unmatched → place-less trip; frontend labels it with the name.
    const first = await request(API_URL)
      .post("/trips/bulk")
      .set(AUTH)
      .send({
        importBatchId: newBatch(),
        trips: [{ placeId: null, sourcePlaceName, displayName: sourcePlaceName, date, notes: "exploratory" }],
      });
    expect(first.status).toBe(200);
    expect(first.body.imported).toBe(1);

    const beforeRows = await prisma.tripLog.findMany({
      where: { userId: ALICE_ID, displayName: sourcePlaceName },
      include: { places: true },
    });
    expect(beforeRows).toHaveLength(1);
    expect(beforeRows[0].places).toEqual([]);

    // 2) The matching place now exists.
    const place = await request(API_URL)
      .post("/places")
      .set(AUTH)
      .send({ name: sourcePlaceName, latitude: -33.6, longitude: 150.2 });
    const placeId = place.body.id as string;

    // 3) Re-import the SAME file, now resolved to the place. importKey is keyed
    // on the raw sourcePlaceName, so the row is updated in place — no duplicate.
    const reimport = await request(API_URL)
      .post("/trips/bulk")
      .set(AUTH)
      .send({
        importBatchId: newBatch(),
        trips: [{ placeId, sourcePlaceName, date, notes: "exploratory" }],
      });
    expect(reimport.status).toBe(200);
    expect(reimport.body.imported).toBe(0);
    expect(reimport.body.updated).toBe(1);

    const afterRows = await prisma.tripLog.findMany({
      where: { userId: ALICE_ID },
      // match the original occurrence regardless of displayName change
      orderBy: { createdAt: "asc" },
      include: { places: true },
    });
    const linked = afterRows.filter((t) =>
      t.places.some((link) => link.placeId === placeId),
    );
    expect(linked).toHaveLength(1); // exactly one row, now linked — not duplicated

    await request(API_URL).delete(`/places/${placeId}`).set(AUTH);
  });
});

describe("DELETE /imports/:batchId — undo (fake auth = alice)", () => {
  it("removes batch-created places + trips but spares merged-into pre-existing places", async () => {
    const run = Date.now();

    // A pre-existing place (manual) that the batch will merge into.
    const preexisting = await request(API_URL)
      .post("/places")
      .set(AUTH)
      .send({ name: `IMP undo preexisting ${run}`, latitude: -33.5, longitude: 150.1 });
    const preexistingId = preexisting.body.id as string;

    const batchId = newBatch();

    // Create a place AND merge into the pre-existing one, same batch.
    const placeImport = await request(API_URL)
      .post("/places/bulk")
      .set(AUTH)
      .send({
        importBatchId: batchId,
        rows: [
          placeRow(`IMP undo created ${run}`, -33.8, 150.4),
          {
            data: { name: `IMP undo preexisting ${run}`, latitude: -33.5, longitude: 150.1, notes: "merged note" },
            resolution: { kind: "merge", placeId: preexistingId },
          },
        ],
      });
    expect(placeImport.status).toBe(200);
    const createdPlace = await prisma.place.findFirst({
      where: { ownerId: ALICE_ID, name: `IMP undo created ${run}` },
    });
    expect(createdPlace).not.toBeNull();

    // A trip in the same batch linked to the created place.
    await request(API_URL)
      .post("/trips/bulk")
      .set(AUTH)
      .send({
        importBatchId: batchId,
        trips: [
          {
            placeId: createdPlace!.id,
            sourcePlaceName: `IMP undo created ${run}`,
            date: "2024-05-01",
          },
        ],
      });

    // Undo the batch.
    const undo = await request(API_URL).delete(`/imports/${batchId}`).set(AUTH);
    expect(undo.status).toBe(200);
    expect(undo.body.deletedPlaces).toBe(1);
    expect(undo.body.deletedTrips).toBe(1);

    // Created place + its trip gone; pre-existing (merged-into) survives.
    const createdAfter = await prisma.place.findFirst({
      where: { ownerId: ALICE_ID, name: `IMP undo created ${run}` },
    });
    expect(createdAfter).toBeNull();
    const preexistingAfter = await prisma.place.findUnique({ where: { id: preexistingId } });
    expect(preexistingAfter).not.toBeNull();
    expect(preexistingAfter?.notes).toBe("merged note"); // merge applied + retained

    await request(API_URL).delete(`/places/${preexistingId}`).set(AUTH);
  });
});

afterAll(async () => {
  // Best-effort cleanup: undo every batch, then drop any stray rows by name prefix.
  for (const batchId of batches) {
    await request(API_URL).delete(`/imports/${batchId}`).set(AUTH);
  }
  await prisma.tripLog.deleteMany({
    where: { userId: ALICE_ID, displayName: { startsWith: "IMP " } },
  });
  await prisma.place.deleteMany({
    where: { ownerId: ALICE_ID, name: { startsWith: "IMP " } },
  });
  await prisma.$disconnect();
});
