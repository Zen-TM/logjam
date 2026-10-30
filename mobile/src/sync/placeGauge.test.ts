// A place's gauge link through the phone: mirror round trip, the outbox op a
// guest or owner queues, and an edit. Real SQLite, as the claims are about rows.
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncDeltaPlaceRow } from "@logjam/shared";

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

const { createPlaceLocal, updatePlaceLocal } = await import("./outbox");
const { getMirrorPlace, upsertPlace } = await import("./mirrorStore");

const TYPE = "b0000000-0000-4000-8000-000000000001";

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(createSchemaSql("mirror"));
  sqlite.exec(createSchemaSql("local"));
});

const ops = () =>
  sqlite.prepare("SELECT op, fields_json FROM outbox ORDER BY seq").all() as {
    op: string;
    fields_json: string;
  }[];

describe("a place's gauge link", () => {
  it("round-trips a delta row, and an older server's row has none", async () => {
    const row = {
      id: "p1",
      ownerId: "u",
      syncRole: "shared",
      name: "n",
      altNames: [],
      latitude: -33.5,
      longitude: 150.4,
      placeTypeId: TYPE,
      notes: null,
      elevation: null,
      fieldValues: {},
      ropeWikiId: null,
      forkedFromId: null,
      createdAt: "",
      updatedAt: "",
    } as SyncDeltaPlaceRow;
    await upsertPlace(db as never, { ...row, gaugeId: "210001" }, []);
    expect((await getMirrorPlace("p1"))?.gaugeId).toBe("210001");
    await upsertPlace(db as never, row, []);
    expect((await getMirrorPlace("p1"))?.gaugeId).toBeNull();
  });

  it("is queued on create and on update, and null clears it", async () => {
    const id = await createPlaceLocal({
      name: "n",
      latitude: -33.5,
      longitude: 150.4,
      placeTypeId: TYPE,
      gaugeId: "210001",
    });
    expect((await getMirrorPlace(id))?.gaugeId).toBe("210001");
    expect(JSON.parse(ops()[0].fields_json).gaugeId).toBe("210001");
    await updatePlaceLocal(id, { gaugeId: null });
    expect((await getMirrorPlace(id))?.gaugeId).toBeNull();
  });
});
