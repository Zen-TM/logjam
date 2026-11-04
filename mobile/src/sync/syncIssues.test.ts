// The DB is a recording stand-in (expo-sqlite cannot load in node), so this
// asserts the SQL a discard runs, as routeOutbox.test.ts does for writes.
import { describe, expect, it, vi } from "vitest";

const runAsync = vi.hoisted(() => vi.fn());
const db = vi.hoisted(() => ({
  runAsync,
  getAllAsync: vi.fn(async () => [] as unknown[]),
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
const deleteAsync = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("expo-file-system/legacy", () => ({ deleteAsync }));
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

  // Mutation: restore or hide the replaced upload on discard, and a link the
  // user gave up on touches a file it never replaced. The discard must only
  // drop the op.
  it("discards a parked link that names a replaced upload without touching media", async () => {
    runAsync.mockClear();
    db.getFirstAsync.mockResolvedValueOnce({
      seq: 9,
      entity: "media",
      op: "link",
      entity_id: "imp",
    });
    await discardParkedOp(9);
    const sql = runAsync.mock.calls.map(([statement]) => String(statement));
    expect(sql).toEqual(["DELETE FROM outbox WHERE seq = ?"]);
  });

  // A parked place create takes the photos and the way queued behind it: they
  // name the place in their payload, not in `entity_id`. Mutation: drop the
  // media loop in discardParkedOp and the photo's op, row and files stay.
  it("discards a place create with its photos, its way's link and their files", async () => {
    runAsync.mockClear();
    db.getAllAsync.mockResolvedValueOnce([
      {
        seq: 6,
        entity_id: "m1",
        op: "create",
        fields_json: JSON.stringify({ linkedType: "place", linkedId: "p1" }),
      },
      {
        seq: 7,
        entity_id: "f1",
        op: "link",
        fields_json: JSON.stringify({ placeId: "p1" }),
      },
      {
        seq: 8,
        entity_id: "m2",
        op: "create",
        fields_json: JSON.stringify({ linkedType: "place", linkedId: "other" }),
      },
    ]);
    db.getFirstAsync
      .mockResolvedValueOnce({
        seq: 5,
        entity: "place",
        op: "create",
        entity_id: "p1",
      } as never)
      .mockResolvedValueOnce({
        local_display_path: "/cache/m1.display",
        local_thumb_path: "/cache/m1.thumb",
      } as never);

    await discardParkedOp(5);

    const sql: [string, unknown[]][] = runAsync.mock.calls.map(
      ([statement, ...args]) => [String(statement), args],
    );
    expect(sql).toContainEqual(["DELETE FROM media WHERE id = ?", ["m1"]]);
    expect(sql).toContainEqual(["DELETE FROM outbox WHERE seq = ?", [6]]);
    expect(sql).toContainEqual(["DELETE FROM outbox WHERE seq = ?", [7]]);
    expect(
      sql.some(
        ([statement, args]) =>
          statement.startsWith("UPDATE media SET linked_type = 'none'") &&
          args[0] === "f1",
      ),
    ).toBe(true);
    // Another place's photo is left alone.
    expect(sql).not.toContainEqual(["DELETE FROM outbox WHERE seq = ?", [8]]);
    expect(deleteAsync).toHaveBeenCalledWith("/cache/m1.display", {
      idempotent: true,
    });
    expect(deleteAsync).toHaveBeenCalledWith("/cache/m1.thumb", {
      idempotent: true,
    });
  });
});
