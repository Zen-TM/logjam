import { beforeEach, describe, expect, it, vi } from "vitest";

// Deleting an attachment whose upload never left the phone. Media ops bypass
// the shared coalescing planner, so its delete-cancellation never applied
// here: the flush ran the queued CREATE first (presign → PUT → confirm, the
// whole file, possibly on metered data) and the delete op then removed it
// server-side again. Correct end state, wasted radio — the exact resource the
// outbox exists to conserve.

type Call = { sql: string; args: unknown[] };
const calls: Call[] = [];
const unlinked: string[] = [];
/** The queued, never-attempted create op, or null when the upload already ran. */
let pendingCreate: { seq: number } | null = null;

const db = {
  runAsync: (sql: string, ...args: unknown[]) => {
    calls.push({ sql, args });
    return Promise.resolve({ changes: 1, lastInsertRowId: 1 });
  },
  getFirstAsync: (sql: string) => {
    calls.push({ sql, args: [] });
    if (sql.includes("FROM outbox")) return Promise.resolve(pendingCreate);
    return Promise.resolve(null);
  },
  getAllAsync: () => Promise.resolve([]),
};

vi.mock("./syncDb", () => ({
  getSyncDb: () => Promise.resolve(db),
  notifyMirrorChanged: () => {},
  withSyncTransaction: async (_db: unknown, task: () => Promise<unknown>) => task(),
}));
vi.mock("./mediaSyncBridge", () => ({ scheduleMutationSync: () => {} }));
// localStores reaches react-native (Flow syntax vitest can't parse) for the
// platform-specific roots — the constant is all this test needs.
vi.mock("../offline/localStores", () => ({ MEDIA_CACHE_DIR: "file:///cache/" }));
vi.mock("../api/apiFetch", () => ({ apiFetch: () => Promise.resolve() }));
// MOT-006: mediaUpload.ts now imports networkPolicy.ts (NetInfo + prefsDb,
// both native) for the metered-upload gate; deleteMediaLocal never reaches
// it, so a bare stand-in is enough.
vi.mock("../offline/networkPolicy", () => ({ canRunNow: () => Promise.resolve(true) }));
vi.mock("expo-image-manipulator", () => ({ manipulateAsync: () => {}, SaveFormat: {} }));
vi.mock("expo-video-thumbnails", () => ({ getThumbnailAsync: () => {} }));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000000",
}));
vi.mock("expo-file-system/legacy", () => ({
  deleteAsync: (path: string) => {
    unlinked.push(path);
    return Promise.resolve();
  },
  copyAsync: () => Promise.resolve(),
  makeDirectoryAsync: () => Promise.resolve(),
  getInfoAsync: () => Promise.resolve({ exists: true, size: 1 }),
}));

const { deleteMediaLocal } = await import("./mediaUpload");

const media = {
  id: "media-1",
  linkedType: "canyon",
  linkedId: "canyon-1",
  mediaType: "image/jpeg",
  filename: "a.jpg",
  color: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  syncState: "pendingUpload",
  localDisplayPath: "file:///cache/media-1.display",
  localThumbPath: "file:///cache/media-1.thumb",
};

const sqlText = () => calls.map((call) => call.sql).join("\n");

describe("deleteMediaLocal", () => {
  beforeEach(() => {
    calls.length = 0;
    unlinked.length = 0;
  });

  it("cancels a never-sent create instead of uploading then deleting", async () => {
    pendingCreate = { seq: 7 };
    await deleteMediaLocal(media);
    expect(sqlText()).toContain("DELETE FROM outbox WHERE seq = ?");
    expect(sqlText()).toContain("DELETE FROM media WHERE id = ?");
    // No delete op: the server never heard of this attachment.
    expect(sqlText()).not.toContain("'media', 'delete'");
    // And the cache blobs go with it, rather than waiting on an op that
    // no longer exists to unlink them.
    expect(unlinked).toEqual([media.localDisplayPath, media.localThumbPath]);
  });

  it("still enqueues a delete op once the upload has been sent", async () => {
    pendingCreate = null;
    await deleteMediaLocal(media);
    expect(sqlText()).toContain("UPDATE media SET sync_state = 'pendingDelete'");
    expect(sqlText()).toContain("'media', 'delete'");
    // runMediaDeleteOp owns the blobs on this path — it needs them until the
    // server confirms.
    expect(unlinked).toEqual([]);
  });
});
