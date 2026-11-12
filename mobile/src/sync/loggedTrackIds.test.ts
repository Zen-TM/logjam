// Which recordings a trip has been logged from, read back from the mirror: a
// delta row names its source, a copy still queued on this phone names it in
// extra_json, and neither a deleted copy nor an old one (no link) counts.
// Real SQLite, as the claim is about rows.
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncDeltaMediaRow } from "@logjam/shared";

const { createSchemaSql } = await import("./mirrorSchema");

let sqlite = new DatabaseSync(":memory:");

const db = {
  runAsync: (sql: string, ...params: unknown[]) => {
    const { changes } = sqlite.prepare(sql).run(...(params as never[]));
    return Promise.resolve({ changes: Number(changes), lastInsertRowId: 0 });
  },
  getFirstAsync: (sql: string, ...params: unknown[]) =>
    Promise.resolve(sqlite.prepare(sql).get(...(params as never[])) ?? null),
  getAllAsync: (sql: string, ...params: unknown[]) =>
    Promise.resolve(sqlite.prepare(sql).all(...(params as never[]))),
};

vi.mock("./syncDb", () => ({
  getSyncDb: () => Promise.resolve(db),
  notifyMirrorChanged: () => {},
}));

const { listLoggedTrackIds, upsertMedia } = await import("./mirrorStore");

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(createSchemaSql("mirror"));
});

const copy = (
  id: string,
  over: Partial<SyncDeltaMediaRow> = {},
): SyncDeltaMediaRow => ({
  id,
  linkedType: "tripLog",
  linkedId: "trip-1",
  mediaType: "application/gpx+xml",
  filename: "a.gpx",
  fileSizeBytes: "10",
  color: null,
  origin: null,
  displayName: null,
  metadata: {},
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...over,
});

describe("listLoggedTrackIds", () => {
  // Mutation: add sourceMediaId to MEDIA_KNOWN in mirrorStore (the delta would
  // no longer reach extra_json), or drop the pendingDelete filter.
  it("reads the source from a synced copy and from one still queued", async () => {
    await upsertMedia(db as never, copy("c1", { sourceMediaId: "rec-1" }));
    // What attachMediaLocal writes for a copy that has not uploaded yet.
    sqlite
      .prepare(
        `INSERT INTO media (id, linked_type, linked_id, media_type, extra_json, sync_state)
         VALUES ('c2', 'tripLog', 'trip-2', 'application/gpx+xml', ?, 'pendingUpload')`,
      )
      .run(JSON.stringify({ sourceMediaId: "rec-2" }));
    expect([...(await listLoggedTrackIds())].sort()).toEqual([
      "rec-1",
      "rec-2",
    ]);
  });

  it("skips an old copy with no link, a place's file, and a deleted copy", async () => {
    await upsertMedia(db as never, copy("old"));
    await upsertMedia(
      db as never,
      copy("place", { linkedType: "place", sourceMediaId: "rec-3" }),
    );
    await upsertMedia(db as never, copy("gone", { sourceMediaId: "rec-4" }));
    sqlite
      .prepare(
        "UPDATE media SET sync_state = 'pendingDelete' WHERE id = 'gone'",
      )
      .run();
    expect([...(await listLoggedTrackIds())]).toEqual([]);
  });
});
