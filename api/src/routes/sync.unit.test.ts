import { describe, it, expect, vi } from "vitest";

// The route module imports the Prisma singleton (and env) at load; mock them
// so importing the pure helpers under test needs no DB/env.
vi.mock("../services/prisma", () => ({ default: {} }));
vi.mock("../lib/env", () => ({ getEnv: () => ({}) }));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  safeErrorForLog: (err: unknown) => err,
}));

import { conflictReceipts, opDependencies, parsePushOp } from "./sync";
import { AppError } from "../middleware/errorHandler";

const BASE = "2026-07-24T00:00:00.000Z";
const LATER = "2026-07-24T01:00:00.000Z";

describe("conflictReceipts (§6 detection, arrival-order resolution)", () => {
  it("no baseUpdatedAt → blind write, no receipts", () => {
    expect(
      conflictReceipts(undefined, new Date(LATER), { notes: "x" }, { notes: "y" }),
    ).toEqual([]);
  });

  it("base matches server → no receipts", () => {
    expect(
      conflictReceipts(BASE, new Date(BASE), { notes: "x" }, { notes: "y" }),
    ).toEqual([]);
  });

  it("stale base + differing server value → receipt with the overwritten value", () => {
    expect(
      conflictReceipts(
        BASE,
        new Date(LATER),
        { notes: "phone edit", quality: 4 },
        { notes: "web edit", quality: 4 },
      ),
    ).toEqual([{ field: "notes", serverValue: "web edit" }]);
  });

  it("stale base but identical values → nothing was overwritten, no receipt", () => {
    expect(
      conflictReceipts(BASE, new Date(LATER), { notes: "same" }, { notes: "same" }),
    ).toEqual([]);
  });

  it("null and undefined server values compare as null", () => {
    expect(
      conflictReceipts(BASE, new Date(LATER), { notes: null }, {}),
    ).toEqual([]);
    expect(
      conflictReceipts(BASE, new Date(LATER), { notes: "x" }, { notes: null }),
    ).toEqual([{ field: "notes", serverValue: null }]);
  });

  it("array/object fields compare structurally", () => {
    expect(
      conflictReceipts(
        BASE,
        new Date(LATER),
        { canyonIds: ["a", "b"] },
        { canyonIds: ["a", "b"] },
      ),
    ).toEqual([]);
    expect(
      conflictReceipts(
        BASE,
        new Date(LATER),
        { canyonIds: ["a", "b"] },
        { canyonIds: ["b", "a"] },
      ),
    ).toEqual([{ field: "canyonIds", serverValue: ["b", "a"] }]);
  });
});

describe("parsePushOp", () => {
  const valid = {
    opId: "op-1",
    entity: "canyon",
    op: "update",
    id: "a2f6f30c-1f9d-4c07-8b3e-2f5d6a7b8c9d",
    baseUpdatedAt: BASE,
    fields: { notes: "x" },
  };

  it("accepts a valid op", () => {
    expect(parsePushOp(valid, 0)).toEqual(valid);
  });

  it("rejects unknown entity, invalid op-for-entity, bad id, bad baseUpdatedAt", () => {
    expect(() => parsePushOp({ ...valid, entity: "media" }, 0)).toThrow(AppError);
    expect(() => parsePushOp({ ...valid, entity: "canyonShare" }, 0)).toThrow(
      AppError,
    );
    expect(() =>
      parsePushOp({ ...valid, entity: "notification", op: "update" }, 0),
    ).toThrow(AppError);
    expect(() => parsePushOp({ ...valid, id: "nope" }, 0)).toThrow(AppError);
    expect(() => parsePushOp({ ...valid, baseUpdatedAt: "garbage" }, 0)).toThrow(
      AppError,
    );
    expect(() => parsePushOp({ ...valid, fields: [] }, 0)).toThrow(AppError);
    expect(() => parsePushOp({ ...valid, opId: "" }, 0)).toThrow(AppError);
  });

  it("media is not a push entity (three-phase flow owns it)", () => {
    expect(() =>
      parsePushOp({ ...valid, entity: "media", op: "create" }, 0),
    ).toThrow(AppError);
  });
});

describe("opDependencies (§8.3 dependency closure)", () => {
  const id = "a2f6f30c-1f9d-4c07-8b3e-2f5d6a7b8c9d";
  const canyonA = "b2f6f30c-1f9d-4c07-8b3e-2f5d6a7b8c9d";
  const canyonB = "c2f6f30c-1f9d-4c07-8b3e-2f5d6a7b8c9d";

  it("creates depend only on referenced canyons", () => {
    expect(
      opDependencies({
        opId: "x",
        entity: "tripLog",
        op: "create",
        id,
        fields: { canyonIds: [canyonA, canyonB] },
      }),
    ).toEqual([canyonA, canyonB]);
    expect(
      opDependencies({
        opId: "x",
        entity: "waypoint",
        op: "create",
        id,
        fields: { canyonId: canyonA },
      }),
    ).toEqual([canyonA]);
  });

  it("updates and deletes depend on their own target row", () => {
    expect(
      opDependencies({ opId: "x", entity: "canyon", op: "delete", id }),
    ).toEqual([id]);
    expect(
      opDependencies({
        opId: "x",
        entity: "tripLog",
        op: "update",
        id,
        fields: { canyonIds: [canyonA] },
      }),
    ).toEqual([id, canyonA]);
  });
});
