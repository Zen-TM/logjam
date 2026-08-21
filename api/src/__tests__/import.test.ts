import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import prisma from "../services/prisma";
import { ALICE_ID } from "./_actors";

// Idempotent file-import endpoints (see plan §6b/§6c, §8).
// Requires `make dev` running with AUTH_MODE=fake (requests = seeded alice).
// Canyon importKeys derive from name+coords, so each test uses a unique run
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

function canyonRow(
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

describe("POST /canyons/bulk — idempotent import (fake auth = alice)", () => {
  it("re-importing the same canyon file is a no-op (no duplicate rows)", async () => {
    const run = Date.now();
    const name = `IMP canyon idempotent ${run}`;
    const batchId = newBatch();
    const body = {
      importBatchId: batchId,
      rows: [canyonRow(name, -33.71, 150.31)],
    };

    const first = await request(API_URL).post("/canyons/bulk").set(AUTH).send(body);
    expect(first.status).toBe(200);
    expect(first.body.created).toBe(1);

    // Same payload, fresh batch id — importKey is derived from name+coords, so
    // the second run must merge into the existing row, not create a duplicate.
    const second = await request(API_URL)
      .post("/canyons/bulk")
      .set(AUTH)
      .send({ ...body, importBatchId: newBatch() });
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(0);

    const rows = await prisma.canyon.findMany({
      where: { ownerId: ALICE_ID, name },
    });
    expect(rows).toHaveLength(1);
  });

  it("respects mergePolicy on a conflicting field and unions null fields", async () => {
    const run = Date.now();
    // A pre-existing, manually-created canyon (no importKey, not batch-stamped).
    const created = await request(API_URL)
      .post("/canyons")
      .set(AUTH)
      .send({ name: `IMP merge target ${run}`, latitude: -33.72, longitude: 150.32, vGrade: 2 });
    expect(created.status).toBe(201);
    const canyonId = created.body.id as string;

    const batchId = newBatch();
    const res = await request(API_URL)
      .post("/canyons/bulk")
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
            resolution: { kind: "merge", canyonId },
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.merged).toBe(1);

    const after = await prisma.canyon.findUnique({ where: { id: canyonId } });
    expect(after?.vGrade).toBe(2); // default policy keeps existing
    expect(after?.notes).toBe("from import"); // null filled, no data lost
    // Merged-into pre-existing row must NOT be batch-stamped (so undo spares it).
    expect(after?.importBatchId).toBeNull();
  });
});

describe("POST /trips/bulk — idempotent import (fake auth = alice)", () => {
  it("keeps same-canyon-same-day repeats as distinct rows; re-import does not grow", async () => {
    const run = Date.now();
    const sourceCanyonName = `IMP trip src ${run}`;
    const date = "2024-03-15";
    const batchId = newBatch();
    // The frontend sets displayName = sourceCanyonName for a canyon-less row
    // (plan §7a); the backend stores what it's given, so mirror that here.
    const trips = [
      { canyonId: null, sourceCanyonName, displayName: sourceCanyonName, date, notes: "lap 1" },
      { canyonId: null, sourceCanyonName, displayName: sourceCanyonName, date, notes: "lap 1" }, // identical → occurrence 1
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
      where: { userId: ALICE_ID, displayName: sourceCanyonName },
    });
    expect(rows).toHaveLength(2);
  });

  it("regression: keying on sourceCanyonName (not canyonId) survives resolution change", async () => {
    const run = Date.now();
    const sourceCanyonName = `IMP phantom ${run}`;
    const date = "2024-04-01";

    // 1) Import unmatched → canyon-less trip; frontend labels it with the name.
    const first = await request(API_URL)
      .post("/trips/bulk")
      .set(AUTH)
      .send({
        importBatchId: newBatch(),
        trips: [{ canyonId: null, sourceCanyonName, displayName: sourceCanyonName, date, notes: "exploratory" }],
      });
    expect(first.status).toBe(200);
    expect(first.body.imported).toBe(1);

    const beforeRows = await prisma.tripLog.findMany({
      where: { userId: ALICE_ID, displayName: sourceCanyonName },
      include: { canyons: true },
    });
    expect(beforeRows).toHaveLength(1);
    expect(beforeRows[0].canyons).toEqual([]);

    // 2) The matching canyon now exists.
    const canyon = await request(API_URL)
      .post("/canyons")
      .set(AUTH)
      .send({ name: sourceCanyonName, latitude: -33.6, longitude: 150.2 });
    const canyonId = canyon.body.id as string;

    // 3) Re-import the SAME file, now resolved to the canyon. importKey is keyed
    // on the raw sourceCanyonName, so the row is updated in place — no duplicate.
    const reimport = await request(API_URL)
      .post("/trips/bulk")
      .set(AUTH)
      .send({
        importBatchId: newBatch(),
        trips: [{ canyonId, sourceCanyonName, date, notes: "exploratory" }],
      });
    expect(reimport.status).toBe(200);
    expect(reimport.body.imported).toBe(0);
    expect(reimport.body.updated).toBe(1);

    const afterRows = await prisma.tripLog.findMany({
      where: { userId: ALICE_ID },
      // match the original occurrence regardless of displayName change
      orderBy: { createdAt: "asc" },
      include: { canyons: true },
    });
    const linked = afterRows.filter((t) =>
      t.canyons.some((link) => link.canyonId === canyonId),
    );
    expect(linked).toHaveLength(1); // exactly one row, now linked — not duplicated

    await request(API_URL).delete(`/canyons/${canyonId}`).set(AUTH);
  });
});

describe("DELETE /imports/:batchId — undo (fake auth = alice)", () => {
  it("removes batch-created canyons + trips but spares merged-into pre-existing canyons", async () => {
    const run = Date.now();

    // A pre-existing canyon (manual) that the batch will merge into.
    const preexisting = await request(API_URL)
      .post("/canyons")
      .set(AUTH)
      .send({ name: `IMP undo preexisting ${run}`, latitude: -33.5, longitude: 150.1 });
    const preexistingId = preexisting.body.id as string;

    const batchId = newBatch();

    // Create a canyon AND merge into the pre-existing one, same batch.
    const canyonImport = await request(API_URL)
      .post("/canyons/bulk")
      .set(AUTH)
      .send({
        importBatchId: batchId,
        rows: [
          canyonRow(`IMP undo created ${run}`, -33.8, 150.4),
          {
            data: { name: `IMP undo preexisting ${run}`, latitude: -33.5, longitude: 150.1, notes: "merged note" },
            resolution: { kind: "merge", canyonId: preexistingId },
          },
        ],
      });
    expect(canyonImport.status).toBe(200);
    const createdCanyon = await prisma.canyon.findFirst({
      where: { ownerId: ALICE_ID, name: `IMP undo created ${run}` },
    });
    expect(createdCanyon).not.toBeNull();

    // A trip in the same batch linked to the created canyon.
    await request(API_URL)
      .post("/trips/bulk")
      .set(AUTH)
      .send({
        importBatchId: batchId,
        trips: [
          {
            canyonId: createdCanyon!.id,
            sourceCanyonName: `IMP undo created ${run}`,
            date: "2024-05-01",
          },
        ],
      });

    // Undo the batch.
    const undo = await request(API_URL).delete(`/imports/${batchId}`).set(AUTH);
    expect(undo.status).toBe(200);
    expect(undo.body.deletedCanyons).toBe(1);
    expect(undo.body.deletedTrips).toBe(1);

    // Created canyon + its trip gone; pre-existing (merged-into) survives.
    const createdAfter = await prisma.canyon.findFirst({
      where: { ownerId: ALICE_ID, name: `IMP undo created ${run}` },
    });
    expect(createdAfter).toBeNull();
    const preexistingAfter = await prisma.canyon.findUnique({ where: { id: preexistingId } });
    expect(preexistingAfter).not.toBeNull();
    expect(preexistingAfter?.notes).toBe("merged note"); // merge applied + retained

    await request(API_URL).delete(`/canyons/${preexistingId}`).set(AUTH);
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
  await prisma.canyon.deleteMany({
    where: { ownerId: ALICE_ID, name: { startsWith: "IMP " } },
  });
  await prisma.$disconnect();
});
