import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import prisma from "../services/prisma";
import {
  ALICE_ID,
  ALICE_SUB,
  BOB_ID,
  BOB_SUB,
  CANYON_TYPE_ID,
  as,
} from "./_actors";

// Idempotent file-import endpoints.
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
      placeTypeId: CANYON_TYPE_ID,
      importBatchId: batchId,
      rows: [placeRow(name, -33.71, 150.31)],
    };

    const first = await request(API_URL)
      .post("/places/bulk")
      .set(AUTH)
      .send(body);
    expect(first.status).toBe(200);
    expect(first.body.created).toBe(1);

    // Same payload, fresh batch id — importKey is derived from name+coords, so
    // the second run must merge into the existing row, not create a duplicate.
    const second = await request(API_URL)
      .post("/places/bulk")
      .set(AUTH)
      .send({
        placeTypeId: CANYON_TYPE_ID,
        ...body,
        importBatchId: newBatch(),
      });
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(0);
    // The same values again change nothing, so there is nothing to restore.
    expect(second.body.restorableUntil).toBeNull();

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
      .send({
        placeTypeId: CANYON_TYPE_ID,
        name: `IMP merge target ${run}`,
        latitude: -33.72,
        longitude: 150.32,
        fieldValues: { v_grade: 2 },
      });
    expect(created.status).toBe(201);
    const placeId = created.body.id as string;

    const batchId = newBatch();
    const res = await request(API_URL)
      .post("/places/bulk")
      .set(AUTH)
      .send({
        placeTypeId: CANYON_TYPE_ID,
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
              fieldValues: { v_grade: 5 },
              notes: "from import",
            },
            resolution: { kind: "merge", placeId },
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.merged).toBe(1);

    const after = await prisma.place.findUnique({ where: { id: placeId } });
    // Default policy keeps the existing value in `fieldValues`.
    expect((after?.fieldValues as Record<string, unknown>).v_grade).toBe(2);
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
    // The frontend sets displayName = sourcePlaceName for a place-less row;
    // the backend stores what it's given, so mirror that here.
    const trips = [
      {
        placeId: null,
        sourcePlaceName,
        displayName: sourcePlaceName,
        date,
        notes: "lap 1",
      },
      {
        placeId: null,
        sourcePlaceName,
        displayName: sourcePlaceName,
        date,
        notes: "lap 1",
      }, // identical → occurrence 1
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
        trips: [
          {
            placeId: null,
            sourcePlaceName,
            displayName: sourcePlaceName,
            date,
            notes: "exploratory",
          },
        ],
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
    const place = await request(API_URL).post("/places").set(AUTH).send({
      placeTypeId: CANYON_TYPE_ID,
      name: sourcePlaceName,
      latitude: -33.6,
      longitude: 150.2,
    });
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
  it("removes batch-created places + trips and restores merged-into pre-existing places", async () => {
    const run = Date.now();

    // A pre-existing place (manual) that the batch will merge into.
    const preexisting = await request(API_URL)
      .post("/places")
      .set(AUTH)
      .send({
        placeTypeId: CANYON_TYPE_ID,
        name: `IMP undo preexisting ${run}`,
        latitude: -33.5,
        longitude: 150.1,
      });
    const preexistingId = preexisting.body.id as string;

    const batchId = newBatch();

    // Create a place AND merge into the pre-existing one, same batch.
    const placeImport = await request(API_URL)
      .post("/places/bulk")
      .set(AUTH)
      .send({
        placeTypeId: CANYON_TYPE_ID,
        importBatchId: batchId,
        rows: [
          placeRow(`IMP undo created ${run}`, -33.8, 150.4),
          {
            data: {
              name: `IMP undo preexisting ${run}`,
              latitude: -33.5,
              longitude: 150.1,
              notes: "merged note",
            },
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

    const merged = await prisma.place.findUnique({
      where: { id: preexistingId },
    });
    expect(merged?.notes).toBe("merged note");
    expect(await prisma.importSnapshot.count({ where: { batchId } })).toBe(1);

    // Undo the batch.
    const undo = await request(API_URL).delete(`/imports/${batchId}`).set(AUTH);
    expect(undo.status).toBe(200);
    expect(undo.body.deletedPlaces).toBe(1);
    expect(undo.body.deletedTrips).toBe(1);
    expect(undo.body.restoredPlaces).toBe(1);
    expect(undo.body.keptFields).toBe(0);

    // Created place + its trip gone; pre-existing (merged-into) survives,
    // with the values it had before the import, and the snapshot is gone.
    const createdAfter = await prisma.place.findFirst({
      where: { ownerId: ALICE_ID, name: `IMP undo created ${run}` },
    });
    expect(createdAfter).toBeNull();
    const preexistingAfter = await prisma.place.findUnique({
      where: { id: preexistingId },
    });
    expect(preexistingAfter).not.toBeNull();
    expect(preexistingAfter?.notes).toBeNull();
    expect(preexistingAfter?.importKey).toBeNull();
    expect(await prisma.importSnapshot.count({ where: { batchId } })).toBe(0);

    await request(API_URL).delete(`/places/${preexistingId}`).set(AUTH);
  });

  // Mutation that turns it red: dropping the createdAt cutoff from
  // restoreBatch's read in lib/importSnapshot.ts.
  it("restores nothing past the retention, and still deletes what the batch created", async () => {
    const run = Date.now();
    const name = `IMP undo expired ${run}`;
    const created = await request(API_URL).post("/places").set(AUTH).send({
      placeTypeId: CANYON_TYPE_ID,
      name,
      latitude: -33.55,
      longitude: 150.15,
    });
    const placeId = created.body.id as string;
    try {
      const batchId = newBatch();
      const res = await request(API_URL)
        .post("/places/bulk")
        .set(AUTH)
        .send({
          placeTypeId: CANYON_TYPE_ID,
          importBatchId: batchId,
          rows: [
            placeRow(`IMP undo expired new ${run}`, -33.56, 150.16),
            {
              data: {
                name,
                latitude: -33.55,
                longitude: 150.15,
                notes: "file",
              },
              resolution: { kind: "merge", placeId },
            },
          ],
        });
      expect(res.body.merged).toBe(1);
      const aged = await prisma.importSnapshot.updateMany({
        where: { batchId },
        data: { createdAt: new Date(Date.now() - 25 * 3_600_000) },
      });
      expect(aged.count).toBe(1);

      const undo = await request(API_URL)
        .delete(`/imports/${batchId}`)
        .set(AUTH);
      expect(undo.status).toBe(200);
      expect(undo.body.deletedPlaces).toBe(1);
      expect(undo.body.restoredPlaces).toBe(0);
      const after = await prisma.place.findUnique({ where: { id: placeId } });
      expect(after?.notes).toBe("file");
      expect(await prisma.importSnapshot.count({ where: { batchId } })).toBe(0);
    } finally {
      await request(API_URL).delete(`/places/${placeId}`).set(AUTH);
    }
  });

  // Mutation that turns it red: restoring a field without checking it still
  // holds what the import wrote, or a restore that skips updatedAt (a raw
  // write), which phones and sharees would never pull.
  it("keeps a field edited since, restores the rest, and the restore reaches a sharee and a phone", async () => {
    const run = Date.now();
    const name = `IMP undo edited ${run}`;
    const created = await request(API_URL).post("/places").set(AUTH).send({
      placeTypeId: CANYON_TYPE_ID,
      name,
      latitude: -33.52,
      longitude: 150.12,
    });
    expect(created.status).toBe(201);
    const placeId = created.body.id as string;
    try {
      const share = await request(API_URL)
        .post(`/places/${placeId}/share`)
        .set(AUTH)
        .send({ sharedWithUserId: BOB_ID });
      expect(share.status).toBe(201);

      const batchId = newBatch();
      const merge = await request(API_URL)
        .post("/places/bulk")
        .set(AUTH)
        .send({
          placeTypeId: CANYON_TYPE_ID,
          importBatchId: batchId,
          rows: [
            {
              data: {
                name,
                latitude: -33.52,
                longitude: 150.12,
                altNames: ["IMP alt"],
                notes: "file note",
                fieldValues: { v_grade: 4 },
              },
              resolution: { kind: "merge", placeId },
            },
          ],
        });
      expect(merge.status).toBe(200);
      expect(merge.body.merged).toBe(1);
      expect(Date.parse(merge.body.restorableUntil)).toBeGreaterThan(
        Date.now(),
      );

      const edit = await request(API_URL)
        .patch(`/places/${placeId}`)
        .set(AUTH)
        .send({ notes: "my note" });
      expect(edit.status).toBe(200);

      const bobPlace = async () =>
        (await request(API_URL).get(`/places/${placeId}`).set(as(BOB_SUB)))
          .body as { fieldValues: Record<string, unknown> };
      expect((await bobPlace()).fieldValues.v_grade).toBe(4);
      const aliceCursor = await deltaCursor(ALICE_SUB);
      const bobCursor = await deltaCursor(BOB_SUB);

      const undo = await request(API_URL)
        .delete(`/imports/${batchId}`)
        .set(AUTH);
      expect(undo.status).toBe(200);
      expect(undo.body.restoredPlaces).toBe(1);
      expect(undo.body.keptFields).toBe(1);

      const after = await prisma.place.findUnique({ where: { id: placeId } });
      expect(after?.notes).toBe("my note");
      expect(after?.altNames).toEqual([]);
      expect(after?.fieldValues).not.toHaveProperty("v_grade");

      expect((await bobPlace()).fieldValues.v_grade).toBeUndefined();
      for (const [sub, cursor] of [
        [ALICE_SUB, aliceCursor],
        [BOB_SUB, bobCursor],
      ]) {
        const row = (await pulledPlaces(sub, cursor)).find(
          (p) => p.id === placeId,
        );
        expect(row, sub).toBeDefined();
        expect(row!.fieldValues).not.toHaveProperty("v_grade");
      }
    } finally {
      await request(API_URL).delete(`/places/${placeId}`).set(AUTH);
    }
  });

  // Mutations that turn it red: moving restoreBatch after the deletes in
  // routes/imports.ts (deleting N renames the trip after it, which Undo then
  // keeps as an edit); dropping the updatedAt touch from a links-only restore
  // (the phone never pulls it); leaving placeIds out of tripFields.
  it("restores a trip a re-import re-linked to a place it created, and a phone pulls it", async () => {
    const run = Date.now();
    const sourcePlaceName = `IMP undo trip ${run}`;
    const trip = { sourcePlaceName, date: "2024-06-01", notes: "lap" };
    const place = await request(API_URL)
      .post("/places")
      .set(AUTH)
      .send({
        placeTypeId: CANYON_TYPE_ID,
        name: `IMP undo trip place ${run}`,
        latitude: -33.53,
        longitude: 150.13,
      });
    const placeId = place.body.id as string;
    try {
      const first = await request(API_URL)
        .post("/trips/bulk")
        .set(AUTH)
        .send({ importBatchId: newBatch(), trips: [{ ...trip, placeId }] });
      expect(first.body.imported).toBe(1);
      const tripRow = await prisma.tripLog.findFirstOrThrow({
        where: { userId: ALICE_ID, places: { some: { placeId } } },
      });

      // One batch creates a place, then re-links the trip to it: only the
      // links change (both are canyons, so the types stay ["canyoning"]).
      const batchId = newBatch();
      const created = await request(API_URL)
        .post("/places/bulk")
        .set(AUTH)
        .send({
          placeTypeId: CANYON_TYPE_ID,
          importBatchId: batchId,
          rows: [placeRow(`IMP undo trip new place ${run}`, -33.54, 150.14)],
        });
      expect(created.body.created).toBe(1);
      const newPlace = await prisma.place.findFirstOrThrow({
        where: { ownerId: ALICE_ID, importBatchId: batchId },
      });
      const reimport = await request(API_URL)
        .post("/trips/bulk")
        .set(AUTH)
        .send({
          importBatchId: batchId,
          trips: [{ ...trip, placeId: newPlace.id }],
        });
      expect(reimport.body.updated).toBe(1);
      const cursor = await deltaCursor(ALICE_SUB);

      const undo = await request(API_URL)
        .delete(`/imports/${batchId}`)
        .set(AUTH);
      expect(undo.status).toBe(200);
      expect(undo.body.deletedPlaces).toBe(1);
      expect(undo.body.restoredTrips).toBe(1);
      expect(undo.body.keptFields).toBe(0);

      const restored = await prisma.tripLog.findUnique({
        where: { id: tripRow.id },
        include: { places: true },
      });
      expect(restored?.displayName).toBeNull();
      expect(restored?.places.map((link) => link.placeId)).toEqual([placeId]);

      const res = await request(API_URL)
        .get("/sync/delta")
        .query({ cursor })
        .set(as(ALICE_SUB))
        .set(CLIENT);
      const pulled = (
        res.body.changes.tripLogs as {
          id: string;
          places: { id: string }[];
        }[]
      ).find((t) => t.id === tripRow.id);
      expect(pulled?.places.map((p) => p.id)).toEqual([placeId]);
    } finally {
      await request(API_URL).delete(`/places/${placeId}`).set(AUTH);
    }
  });
});

const CLIENT = { "x-logjam-client": "mobile/0.1.0-test" } as const;

/** Where a phone that pulled everything now stands. */
async function deltaCursor(sub: string): Promise<string> {
  let cursor = "";
  for (;;) {
    const res = await request(API_URL)
      .get("/sync/delta")
      .query({ cursor })
      .set(as(sub))
      .set(CLIENT);
    expect(res.status).toBe(200);
    cursor = res.body.cursor;
    if (!res.body.hasMore) return cursor;
  }
}

/** The place rows a phone at `cursor` pulls next. */
async function pulledPlaces(sub: string, cursor: string) {
  const res = await request(API_URL)
    .get("/sync/delta")
    .query({ cursor })
    .set(as(sub))
    .set(CLIENT);
  expect(res.status).toBe(200);
  return res.body.changes.places as {
    id: string;
    fieldValues: Record<string, unknown>;
  }[];
}

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
