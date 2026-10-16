// The DB is a recording stand-in (expo-sqlite cannot load in node), so this
// asserts the SQL a discard runs, as routeOutbox.test.ts does for writes.
import { describe, expect, it, vi } from "vitest";

const runAsync = vi.hoisted(() => vi.fn());
const db = vi.hoisted(() => ({
  runAsync,
  getFirstAsync: vi.fn(async () => ({
    seq: 5,
    entity: "place",
    op: "create",
    entity_id: "p1",
  })),
}));
vi.mock("./syncDb", () => ({
  getSyncDb: async () => db,
  withSyncTransaction: async (_db: unknown, task: () => Promise<void>) =>
    task(),
  getSyncStateValue: vi.fn(),
  notifyMirrorChanged: vi.fn(),
  wipeMirror: vi.fn(),
}));
vi.mock("expo-file-system/legacy", () => ({ deleteAsync: vi.fn() }));
vi.mock("./mirrorStore", () => ({}));
vi.mock("./outbox", () => ({}));
vi.mock("./deltaPull", () => ({}));
vi.mock("./syncEngine", () => ({ requestSync: vi.fn() }));

const { discardParkedOp } = await import("./syncIssues");

describe("discardParkedOp", () => {
  // Mutation: delete only the discarded op's own row.
  it("discards a create with every queued op that still points at its row", async () => {
    await discardParkedOp(5);
    const sql = runAsync.mock.calls.map(([statement, ...args]) => [
      statement,
      args,
    ]);
    expect(sql).toContainEqual([
      "DELETE FROM outbox WHERE entity_id = ? AND seq != ?",
      ["p1", 5],
    ]);
    expect(sql).toContainEqual(["DELETE FROM outbox WHERE seq = ?", [5]]);
  });
});
