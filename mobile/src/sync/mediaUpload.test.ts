import { beforeEach, describe, expect, it, vi } from "vitest";

// MOT-005/D6: attachMediaLocal now deletes the picker/camera source once it
// has fully copied (and, for images/video, read) it — closing the leak where
// expo-image-picker's and expo-document-picker's own cache copies survived
// outside every declared store and outside the account-transition wipe.
//
// The guard this test exists to pin: a source under one of THIS APP's own
// declared stores must survive, because its lifecycle is governed elsewhere.
// The live case is saved/assetActions.ts's "attach to canyon" for a vector
// import, which reuses `vector_import.sourcePath` — the app's only kept
// original of a lossy GPX/KML derivation (mobile/CLAUDE.md, "Imports keep
// their ORIGINAL BYTES"). A naive "always delete file.uri" would destroy it.

const calls: { sql: string; args: unknown[] }[] = [];
const unlinked: string[] = [];

const db = {
  runAsync: (sql: string, ...args: unknown[]) => {
    calls.push({ sql, args });
    return Promise.resolve({ changes: 1, lastInsertRowId: 1 });
  },
  getFirstAsync: () => Promise.resolve(null),
  getAllAsync: () => Promise.resolve([]),
};

vi.mock("./syncDb", () => ({
  getSyncDb: () => Promise.resolve(db),
  notifyMirrorChanged: () => {},
  withSyncTransaction: async (_db: unknown, task: () => Promise<unknown>) => task(),
}));
vi.mock("./mediaSyncBridge", () => ({ scheduleMutationSync: () => {} }));
const apiFetch = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>({}));
vi.mock("../api/apiFetch", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
const canRunNow = vi.fn((..._args: unknown[]) => Promise.resolve(true));
vi.mock("../offline/networkPolicy", () => ({ canRunNow: (...args: unknown[]) => canRunNow(...args) }));
// Real localStores.ts reaches react-native (Flow syntax vitest can't parse);
// same stand-in technique mediaDelete.test.ts already uses, extended with
// WIPED_DIRS since that's the guard under test.
vi.mock("../offline/localStores", () => ({
  MEDIA_CACHE_DIR: "file:///cache/media-cache/",
  WIPED_DIRS: [
    "file:///cache/media-cache/",
    "file:///docs/offline/regions/",
    "file:///docs/offline/overlays/",
    "file:///docs/imports/",
    "file:///scratch/logjam-scratch/",
    "file:///docs/sensor-logs/",
  ],
}));
vi.mock("expo-image-manipulator", () => ({ manipulateAsync: () => {}, SaveFormat: {} }));
vi.mock("expo-video-thumbnails", () => ({ getThumbnailAsync: () => {} }));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000000",
}));
const uploaded: string[] = [];
vi.mock("expo-file-system/legacy", () => ({
  deleteAsync: (path: string) => {
    unlinked.push(path);
    return Promise.resolve();
  },
  copyAsync: () => Promise.resolve(),
  makeDirectoryAsync: () => Promise.resolve(),
  getInfoAsync: () => Promise.resolve({ exists: true, size: 1 }),
  // The media PUT goes through uploadToPresignedUrl now, which uses the TASK
  // api so it can cancel a transfer that never starts (MAPP-006). The task
  // reports progress immediately here, so the first-byte deadline never fires.
  createUploadTask: (
    _url: string,
    fileUri: string,
    _options: unknown,
    onProgress?: (p: { totalBytesSent: number }) => void,
  ) => ({
    uploadAsync: () => {
      onProgress?.({ totalBytesSent: 1 });
      uploaded.push(fileUri);
      return Promise.resolve({ status: 200 });
    },
    cancelAsync: () => Promise.resolve(),
  }),
  FileSystemUploadType: { BINARY_CONTENT: "BINARY_CONTENT" },
}));

const { attachMediaLocal, runMediaCreateOp } = await import("./mediaUpload");

describe("attachMediaLocal", () => {
  beforeEach(() => {
    calls.length = 0;
    unlinked.length = 0;
  });

  it("deletes a picker/camera source once it has been copied", async () => {
    // Not under any of our declared stores — exactly what
    // expo-image-picker's/expo-document-picker's own cache dirs look like
    // from here (localStores.test.ts enforces that nothing else in this
    // codebase names a filesystem root).
    const source = "file:///data/user/0/app/cache/ImagePicker/abc.jpg";
    await attachMediaLocal("canyon", "canyon-1", {
      uri: source,
      mimeType: "application/gpx+xml",
      fileName: "track.gpx",
    });
    expect(unlinked).toContain(source);
  });

  it("does not delete a source this app already owns the lifecycle of", async () => {
    const source = "file:///docs/imports/geopdf-or-vector/original.gpx";
    await attachMediaLocal("canyon", "canyon-1", {
      uri: source,
      mimeType: "application/gpx+xml",
      fileName: "track.gpx",
    });
    expect(unlinked).not.toContain(source);
  });
});

describe("runMediaCreateOp", () => {
  beforeEach(() => {
    calls.length = 0;
    uploaded.length = 0;
    apiFetch.mockReset().mockResolvedValue({
      mediaId: "media-1",
      displayUploadUrl: "https://s3.example/display",
      thumbnailUploadUrl: null,
    });
    canRunNow.mockReset().mockResolvedValue(true);
  });

  const row = {
    seq: 7,
    entity_id: "media-1",
    op: "create",
    fields_json: JSON.stringify({
      linkedType: "canyon",
      linkedId: "canyon-1",
      filename: "a.jpg",
      mediaType: "image/jpeg",
      sizeBytes: 1,
      localDisplayPath: "file:///cache/media-cache/media-1.display",
      localThumbPath: null,
    }),
    media_phase: null,
    attempts: 2,
  };

  it("MOT-006: defers the PUT without spending an attempt when metered policy says no", async () => {
    canRunNow.mockResolvedValue(false);
    const outcome = await runMediaCreateOp(row);
    expect(outcome).toBe("blocked");
    // The actual media bytes never moved...
    expect(uploaded).toEqual([]);
    // ...and flush.ts's optimistic bump (attempts already incremented before
    // calling in) is undone, so waiting for Wi-Fi never counts toward
    // MEDIA_MAX_ATTEMPTS and never surfaces as a Sync Issue.
    const reset = calls.find((c) => c.sql.includes("state = 'queued'"));
    expect(reset?.args).toEqual([row.attempts, row.seq]);
  });

  it("PUTs the media bytes once metered policy allows it", async () => {
    canRunNow.mockResolvedValue(true);
    apiFetch.mockResolvedValueOnce({
      mediaId: "media-1",
      displayUploadUrl: "https://s3.example/display",
      thumbnailUploadUrl: null,
    });
    apiFetch.mockResolvedValueOnce({
      id: "media-1",
      linkedType: "canyon",
      linkedId: "canyon-1",
      mediaType: "image/jpeg",
      filename: "a.jpg",
      fileSizeBytes: 1,
      color: null,
      createdAt: "2026-08-01T00:00:00.000Z",
    });
    const outcome = await runMediaCreateOp(row);
    expect(outcome).toBe("done");
    expect(uploaded).toEqual(["file:///cache/media-cache/media-1.display"]);
  });
});
