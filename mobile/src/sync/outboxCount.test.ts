// "N waiting to sync" counts things the user made, not queued operations.
// Real SQLite, as the claim is about rows.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";

const { createSchemaSql } = await import("./mirrorSchema");
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(createSchemaSql("local"));

vi.mock("./syncDb", () => ({
  getSyncDb: () =>
    Promise.resolve({
      getFirstAsync: (sql: string) =>
        Promise.resolve(sqlite.prepare(sql).get() ?? null),
    }),
  notifyMirrorChanged: () => {},
  withSyncTransaction: async () => {},
}));
vi.mock("./mediaSyncBridge", () => ({ scheduleMutationSync: () => {} }));
vi.mock("expo-file-system/legacy", () => ({}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "" }));

const { countPendingOps } = await import("./outbox");

let n = 0;
function enqueue(entity: string, id: string, op: string, state = "queued") {
  sqlite
    .prepare(
      "INSERT INTO outbox (op_id, entity, op, entity_id, state, created_at) VALUES (?, ?, ?, ?, ?, 0)",
    )
    .run(`op${n++}`, entity, op, id, state);
}

describe("countPendingOps", () => {
  // Mutation: COUNT(*) instead of counting distinct entities (gives 5).
  it("counts a place created and edited, a track and a trip as three", async () => {
    enqueue("place", "p1", "create");
    enqueue("place", "p1", "update");
    enqueue("route", "r1", "create");
    enqueue("tripLog", "t1", "create");
    enqueue("placeLink", "l1", "create");
    expect(await countPendingOps()).toBe(3);
  });

  it("leaves out ops parked for the user to resolve", async () => {
    enqueue("place", "p2", "create", "blocked");
    expect(await countPendingOps()).toBe(3);
  });
});
