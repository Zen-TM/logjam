// A place type made on the phone, before any sync has answered.
//
// The local INSERT cannot name an owner (a guest has none, and nobody has one
// offline until the server sends the row back), so the mirror row's `owner_id`
// is NULL: the same value a built-in carries. Reading that NULL as "built-in"
// listed the type the user had just made under "Built in" with no way to
// rename or delete it, gave the next type the same position, and — on an
// install whose mirror held nothing else — replaced Canyon, Campsite and
// Marker in every picker.
//
// Real SQLite, because every one of those is a claim about rows.
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isSystemPlaceTypeId,
  SYSTEM_PLACE_TYPES,
  type SyncDeltaPlaceTypeRow,
} from "@logjam/shared";

const { createSchemaSql } = await import("./mirrorSchema");

let sqlite = new DatabaseSync(":memory:");

const db = {
  runAsync: (sql: string, ...params: unknown[]) => {
    sqlite.prepare(sql).run(...(params as never[]));
    return Promise.resolve({ changes: 0, lastInsertRowId: 0 });
  },
  getFirstAsync: (sql: string, ...params: unknown[]) =>
    Promise.resolve(sqlite.prepare(sql).get(...(params as never[])) ?? null),
  getAllAsync: (sql: string, ...params: unknown[]) =>
    Promise.resolve(sqlite.prepare(sql).all(...(params as never[]))),
};

vi.mock("./syncDb", () => ({
  getSyncDb: () => Promise.resolve(db),
  notifyMirrorChanged: () => {},
  withSyncTransaction: async (_db: unknown, task: () => Promise<void>) => {
    await task();
  },
}));
vi.mock("./mediaSyncBridge", () => ({ scheduleMutationSync: () => {} }));
vi.mock("expo-file-system/legacy", () => ({
  deleteAsync: () => Promise.resolve(),
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () =>
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    }),
}));

const { createPlaceTypeLocal } = await import("./outbox");
const { listMirrorPlaceTypes, upsertPlaceType } = await import("./mirrorStore");

const draft = (name: string) => ({
  name,
  iconKey: "circle",
  color: "#CDC8C1",
});

/** What a first pull leaves behind: the three global rows. */
async function pullSystemTypes() {
  for (const type of SYSTEM_PLACE_TYPES) {
    const row: SyncDeltaPlaceTypeRow = {
      id: type.id,
      ownerId: null,
      name: type.name,
      iconKey: type.iconKey,
      color: type.color,
      position: type.position,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    await upsertPlaceType(db as never, row, []);
  }
}

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(createSchemaSql("mirror"));
  sqlite.exec(createSchemaSql("local"));
});

describe("a place type made on this phone, not yet synced", () => {
  it("is the user's own, listed after the built-ins", async () => {
    await pullSystemTypes();
    const id = await createPlaceTypeLocal(draft("Cave"));
    const types = await listMirrorPlaceTypes();
    expect(types.map((type) => type.name)).toEqual([
      "Canyon",
      "Campsite",
      "Marker",
      "Cave",
    ]);
    // What the editor asks to decide "built in" (`isSystemPlaceType`).
    expect(isSystemPlaceTypeId(id)).toBe(false);
    expect(types.filter((type) => isSystemPlaceTypeId(type.id))).toHaveLength(
      3,
    );
  });

  it("takes the next position after the last one made here", async () => {
    await pullSystemTypes();
    await createPlaceTypeLocal(draft("Cave"));
    await createPlaceTypeLocal(draft("Lookout"));
    const own = (await listMirrorPlaceTypes()).filter(
      (type) => !isSystemPlaceTypeId(type.id),
    );
    // Mutation: counting only rows with an owner gives both types position 3.
    expect(own.map((type) => [type.name, type.position])).toEqual([
      ["Cave", 3],
      ["Lookout", 4],
    ]);
  });

  // A guest never pulls, so the built-ins are never mirrored.
  it("does not take the built-ins away from an install that never pulled", async () => {
    await createPlaceTypeLocal(draft("Cave"));
    const types = await listMirrorPlaceTypes();
    expect(types.map((type) => type.name)).toEqual([
      "Canyon",
      "Campsite",
      "Marker",
      "Cave",
    ]);
  });
});
