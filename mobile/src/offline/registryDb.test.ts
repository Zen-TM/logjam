import { describe, expect, it, vi } from "vitest";

// An app kill mid-transfer leaves a single-file pmtiles writer's
// output on disk with no registry row and no resumable state — nothing
// discovers or deletes it. `sweepOrphanFiles` is the fix; this pins its
// three cases with a mocked directory listing and a mocked registry, the
// same recording-stand-in technique syncDb.test.ts uses for expo-sqlite.

const artifactRows: { id: string }[] = [];
const nativeDb = {
  execAsync: () => Promise.resolve(),
  runAsync: () => Promise.resolve({ changes: 0, lastInsertRowId: 0 }),
  getFirstAsync: () => Promise.resolve(null),
  getAllAsync: () => Promise.resolve(artifactRows),
  withTransactionAsync: async (task: () => Promise<void>) => task(),
};
vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: () => Promise.resolve(nativeDb),
}));

const dirNames: string[] = [];
const deleted: string[] = [];
let failDelete = false;
vi.mock("expo-file-system/legacy", () => ({
  getInfoAsync: () => Promise.resolve({ exists: true }),
  readDirectoryAsync: () => Promise.resolve(dirNames),
  deleteAsync: (uri: string) => {
    if (failDelete) return Promise.reject(new Error("busy"));
    deleted.push(uri);
    return Promise.resolve();
  },
}));

const { sweepOrphanFiles } = await import("./registryDb");

describe("sweepOrphanFiles", () => {
  it("deletes a file with no registry row and no live claim", async () => {
    dirNames.length = 0;
    dirNames.push("orphan.pmtiles");
    artifactRows.length = 0;
    deleted.length = 0;

    // Mutation: return 0 whatever it deleted, and a sweep that took a first
    // save's clip never reconciles the kept weather run (regionMbtiles.ts).
    expect(await sweepOrphanFiles("dir/", ".pmtiles")).toBe(1);

    expect(deleted).toEqual(["dir/orphan.pmtiles"]);
  });

  it("spares a file whose id is registered", async () => {
    dirNames.length = 0;
    dirNames.push("kept.pmtiles");
    artifactRows.length = 0;
    artifactRows.push({ id: "kept" });
    deleted.length = 0;

    expect(await sweepOrphanFiles("dir/", ".pmtiles")).toBe(0);

    expect(deleted).toEqual([]);
  });

  it("spares a file whose id is a live, in-progress download", async () => {
    dirNames.length = 0;
    dirNames.push("inflight.pmtiles");
    artifactRows.length = 0;
    deleted.length = 0;

    expect(
      await sweepOrphanFiles("dir/", ".pmtiles", new Set(["inflight"])),
    ).toBe(0);

    expect(deleted).toEqual([]);
  });

  it("ignores files with a different extension", async () => {
    dirNames.length = 0;
    dirNames.push("region.mbtiles");
    artifactRows.length = 0;
    deleted.length = 0;

    expect(await sweepOrphanFiles("dir/", ".pmtiles")).toBe(0);

    expect(deleted).toEqual([]);
  });

  // Mutation: count the file before (or whatever became of) its delete, and a
  // clip that could not be deleted reconciles the kept weather run for
  // nothing, every Saved-tab open.
  it("counts only the files it deleted", async () => {
    dirNames.length = 0;
    dirNames.push("stuck.pmtiles");
    artifactRows.length = 0;
    deleted.length = 0;
    failDelete = true;
    try {
      expect(await sweepOrphanFiles("dir/", ".pmtiles")).toBe(0);
    } finally {
      failDelete = false;
    }
  });
});
