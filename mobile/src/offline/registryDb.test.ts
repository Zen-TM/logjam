import { describe, expect, it, vi } from "vitest";

// An app kill mid-transfer leaves a single-file pmtiles writer's
// output on disk with no registry row and no resumable state — nothing
// discovers or deletes it. `sweepOrphanFiles` is the fix; this pins its
// three cases with a mocked directory listing and a mocked registry, the
// same recording-stand-in technique syncDb.test.ts uses for expo-sqlite.

const artifactRows: Record<string, unknown>[] = [];
const runs: { sql: string; args: unknown[] }[] = [];
const nativeDb = {
  execAsync: () => Promise.resolve(),
  runAsync: (sql: string, ...args: unknown[]) => {
    runs.push({ sql, args });
    return Promise.resolve({ changes: 0, lastInsertRowId: 0 });
  },
  getFirstAsync: () => Promise.resolve(null),
  getAllAsync: () => Promise.resolve(artifactRows),
  withTransactionAsync: async (task: () => Promise<void>) => task(),
};
vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: () => Promise.resolve(nativeDb),
}));

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

const { insertArtifact, listArtifacts, sweepOrphanFiles } = await import(
  "./registryDb"
);

describe("the archive a vector clip was cut from", () => {
  const clip = {
    id: "clip",
    kind: "basemap-region" as const,
    logicalKey: "protomaps",
    format: "pmtiles" as const,
    sourceType: "vector" as const,
    path: "/files/clip.pmtiles",
    bbox: null,
    minzoom: null,
    maxzoom: null,
    sizeBytes: 1,
    downloadedAt: "2026-11-16T00:00:00.000Z",
  };

  // Mutation: leave `archivePath` out of the INSERT's values, and a saved
  // vector clip is filed with no archive, so the map never draws it.
  it("is written with the clip", async () => {
    runs.length = 0;
    await insertArtifact({ ...clip, archivePath: "master/basemap/a.pmtiles" });
    const insert = runs.find((r) => r.sql.includes("INSERT"))!;
    expect(insert.sql).toContain("archivePath");
    expect(insert.args.at(-1)).toBe("master/basemap/a.pmtiles");
    runs.length = 0;
    await insertArtifact(clip);
    expect(runs[0]!.args.at(-1)).toBeNull();
  });

  // Mutation: leave `archivePath` out of `rowToArtifact`, and the resolver
  // sees every clip as saved before archives were kept.
  it("is read back with the clip", async () => {
    artifactRows.length = 0;
    artifactRows.push({
      ...clip,
      west: null,
      south: null,
      east: null,
      north: null,
      archivePath: "master/basemap/a.pmtiles",
    });
    expect((await listArtifacts())[0]!.archivePath).toBe(
      "master/basemap/a.pmtiles",
    );
  });
});

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
