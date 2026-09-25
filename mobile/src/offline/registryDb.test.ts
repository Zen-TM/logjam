import { describe, expect, it, vi } from "vitest";

// MOT-002: an app kill mid-transfer leaves a single-file pmtiles writer's
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
vi.mock("expo-sqlite", () => ({ openDatabaseAsync: () => Promise.resolve(nativeDb) }));

const dirNames: string[] = [];
const deleted: string[] = [];
vi.mock("expo-file-system/legacy", () => ({
  getInfoAsync: () => Promise.resolve({ exists: true }),
  readDirectoryAsync: () => Promise.resolve(dirNames),
  deleteAsync: (uri: string) => {
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

    await sweepOrphanFiles("dir/", ".pmtiles");

    expect(deleted).toEqual(["dir/orphan.pmtiles"]);
  });

  it("spares a file whose id is registered", async () => {
    dirNames.length = 0;
    dirNames.push("kept.pmtiles");
    artifactRows.length = 0;
    artifactRows.push({ id: "kept" });
    deleted.length = 0;

    await sweepOrphanFiles("dir/", ".pmtiles");

    expect(deleted).toEqual([]);
  });

  it("spares a file whose id is a live, in-progress download", async () => {
    dirNames.length = 0;
    dirNames.push("inflight.pmtiles");
    artifactRows.length = 0;
    deleted.length = 0;

    await sweepOrphanFiles("dir/", ".pmtiles", new Set(["inflight"]));

    expect(deleted).toEqual([]);
  });

  it("ignores files with a different extension", async () => {
    dirNames.length = 0;
    dirNames.push("region.mbtiles");
    artifactRows.length = 0;
    deleted.length = 0;

    await sweepOrphanFiles("dir/", ".pmtiles");

    expect(deleted).toEqual([]);
  });
});
