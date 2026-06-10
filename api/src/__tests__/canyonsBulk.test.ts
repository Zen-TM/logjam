import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import prisma from "../services/prisma";

// Requires `make dev` running with AUTH_MODE=fake (requests = seeded alice).
// BOB_ID owns no canyons in the seed; tests that need a "foreign" canyon
// create one directly via Prisma (owned by bob) and clean it up afterwards.
const API_URL = process.env.API_URL ?? "http://localhost:8080";
const AUTH = { Authorization: "Bearer fake-token" } as const;

const BOB_ID = "00000000-0000-0000-0000-000000000002";

const NONEXISTENT_ID = "99999999-9999-9999-9999-999999999999";

async function createCanyon(name: string): Promise<string> {
  const res = await request(API_URL)
    .post("/canyons")
    .set(AUTH)
    .send({ name, latitude: -33.7, longitude: 150.3 });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("POST /canyons/bulk (fake auth = alice)", () => {
  it("create mode: inserts valid rows and reports per-row errors for invalid ones", async () => {
    const res = await request(API_URL)
      .post("/canyons/bulk")
      .set(AUTH)
      .send({
        mode: "create",
        canyons: [
          { name: "CH-002 bulk valid", latitude: -33.7, longitude: 150.3 },
          { name: "", latitude: -33.7, longitude: 150.3 },
          { name: "CH-002 bulk bad lat", latitude: 999, longitude: 150.3 },
          { name: "CH-002 bulk bad grade", latitude: -33.7, longitude: 150.3, vGrade: 99 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(res.body.replaced).toBe(0);
    expect(res.body.errors).toEqual([
      { rowIndex: 1, message: "Row 1: name is required" },
      { rowIndex: 2, message: "Row 2: invalid latitude" },
      { rowIndex: 3, message: "Row 3: vGrade must be an integer between 1 and 7" },
    ]);

    const listRes = await request(API_URL).get("/canyons").set(AUTH);
    const created = listRes.body.find((c: { name: string }) => c.name === "CH-002 bulk valid");
    expect(created).toBeDefined();

    await request(API_URL).delete(`/canyons/${created.id}`).set(AUTH);
  });

  it("create mode: rejects an empty canyons array with 400", async () => {
    const res = await request(API_URL)
      .post("/canyons/bulk")
      .set(AUTH)
      .send({ mode: "create", canyons: [] });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown mode with 400", async () => {
    const res = await request(API_URL)
      .post("/canyons/bulk")
      .set(AUTH)
      .send({ mode: "frobnicate", canyons: [] });
    expect(res.status).toBe(400);
  });

  it("replace mode: updates an owned canyon's fields", async () => {
    const id = await createCanyon("CH-002 bulk replace target");
    try {
      const res = await request(API_URL)
        .post("/canyons/bulk")
        .set(AUTH)
        .send({
          mode: "replace",
          replacements: [
            {
              canyonId: id,
              data: { name: "CH-002 bulk replace target (updated)", latitude: -33.8, longitude: 150.4 },
            },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ created: 0, replaced: 1, errors: [] });

      const getRes = await request(API_URL).get(`/canyons/${id}`).set(AUTH);
      expect(getRes.body.name).toBe("CH-002 bulk replace target (updated)");
      expect(getRes.body.latitude).toBeCloseTo(-33.8);
    } finally {
      await request(API_URL).delete(`/canyons/${id}`).set(AUTH);
    }
  });

  it("replace mode: a row with a non-existent canyonId is reported as a per-row error", async () => {
    const res = await request(API_URL)
      .post("/canyons/bulk")
      .set(AUTH)
      .send({
        mode: "replace",
        replacements: [
          {
            canyonId: NONEXISTENT_ID,
            data: { name: "CH-002 bulk nonexistent", latitude: -33.7, longitude: 150.3 },
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      created: 0,
      replaced: 0,
      errors: [{ rowIndex: 0, message: "Row 0: canyon not found" }],
    });
  });

  it("replace mode: rejects a foreign-owned canyonId with 403 (no rows updated)", async () => {
    const foreign = await prisma.canyon.create({
      data: {
        ownerId: BOB_ID,
        name: "CH-002 bob's canyon",
        latitude: -33.5,
        longitude: 150.1,
      },
    });
    try {
      const res = await request(API_URL)
        .post("/canyons/bulk")
        .set(AUTH)
        .send({
          mode: "replace",
          replacements: [
            {
              canyonId: foreign.id,
              data: { name: "CH-002 hijacked", latitude: -33.7, longitude: 150.3 },
            },
          ],
        });
      expect(res.status).toBe(403);

      // Confirm the foreign canyon was not modified.
      const after = await prisma.canyon.findUnique({ where: { id: foreign.id } });
      expect(after?.name).toBe("CH-002 bob's canyon");
    } finally {
      await prisma.canyon.delete({ where: { id: foreign.id } });
    }
  });
});

describe("POST /canyons/bulk/delete (fake auth = alice)", () => {
  it("deletes only owned canyons from a mixed owned/foreign id list", async () => {
    const ownedId = await createCanyon("CH-002 bulk delete owned");
    const foreign = await prisma.canyon.create({
      data: {
        ownerId: BOB_ID,
        name: "CH-002 bulk delete foreign",
        latitude: -33.5,
        longitude: 150.1,
      },
    });
    try {
      const res = await request(API_URL)
        .post("/canyons/bulk/delete")
        .set(AUTH)
        .send({ ids: [ownedId, foreign.id] });
      expect(res.status).toBe(200);
      expect(res.body.deletedIds).toEqual([ownedId]);

      const ownedAfter = await request(API_URL).get(`/canyons/${ownedId}`).set(AUTH);
      expect(ownedAfter.status).toBe(404);

      const foreignAfter = await prisma.canyon.findUnique({ where: { id: foreign.id } });
      expect(foreignAfter).not.toBeNull();
    } finally {
      await prisma.canyon.deleteMany({ where: { id: foreign.id } });
    }
  });

  it("returns an empty deletedIds list when all ids are foreign-owned", async () => {
    const foreign = await prisma.canyon.create({
      data: {
        ownerId: BOB_ID,
        name: "CH-002 bulk delete all-foreign",
        latitude: -33.5,
        longitude: 150.1,
      },
    });
    try {
      const res = await request(API_URL)
        .post("/canyons/bulk/delete")
        .set(AUTH)
        .send({ ids: [foreign.id] });
      expect(res.status).toBe(200);
      expect(res.body.deletedIds).toEqual([]);

      const foreignAfter = await prisma.canyon.findUnique({ where: { id: foreign.id } });
      expect(foreignAfter).not.toBeNull();
    } finally {
      await prisma.canyon.deleteMany({ where: { id: foreign.id } });
    }
  });

  it("rejects an empty ids array with 400", async () => {
    const res = await request(API_URL)
      .post("/canyons/bulk/delete")
      .set(AUTH)
      .send({ ids: [] });
    expect(res.status).toBe(400);
  });

  it("rejects more than 500 ids with 400", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `id-${i}`);
    const res = await request(API_URL)
      .post("/canyons/bulk/delete")
      .set(AUTH)
      .send({ ids });
    expect(res.status).toBe(400);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
