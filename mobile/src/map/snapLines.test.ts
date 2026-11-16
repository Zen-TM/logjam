// Which archive a segment snaps to: the vector archive of the region it is in,
// from a saved clip of it where one holds both ends, else from the CDN.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetched = vi.hoisted(() => ({
  calls: [] as unknown[],
}));
vi.mock("expo-file-system/legacy", () => ({
  EncodingType: { Base64: "base64" },
  readAsStringAsync: vi.fn(),
}));
vi.mock("../config", () => ({
  config: { topoCdnBaseUrl: "https://cdn.test" },
}));
vi.mock("@logjam/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@logjam/shared")>()),
  fetchSnapLines: vi.fn(async (archive: unknown) => {
    fetched.calls.push(archive);
    return [];
  }),
}));

const { collectSnapLines } = await import("./snapLines");

const FROM: [number, number] = [150.3, -33.7];
const TO: [number, number] = [150.31, -33.71];
const NSW_PATH = "master/basemap/protomaps-nsw.pmtiles";
const clip = (archivePath: string | null) => ({
  id: "c",
  kind: "basemap-region" as const,
  logicalKey: "protomaps",
  format: "pmtiles" as const,
  sourceType: "vector" as const,
  path: "/files/c.pmtiles",
  bbox: [150, -34, 151, -33] as [number, number, number, number],
  minzoom: 0,
  maxzoom: 15,
  sizeBytes: 1,
  downloadedAt: "2026-11-16T00:00:00.000Z",
  archivePath,
});

beforeEach(() => {
  fetched.calls = [];
});

describe("collectSnapLines", () => {
  // Mutation: read the archive from the catalogue entry or a fixed path in
  // place of the region's, and a segment over NSW no longer reads
  // today's archive from the CDN.
  it("reads the NSW archive from the CDN for a segment in NSW", async () => {
    await collectSnapLines("trails", FROM, TO);
    expect(fetched.calls).toEqual([`https://cdn.test/${NSW_PATH}`]);
  });

  // Mutation: fall back to NSW's archive where the segment's region has none,
  // and snapping outside every region asks the CDN for an archive that holds
  // nothing there.
  it("reads nothing for a segment outside every region", async () => {
    expect(
      await collectSnapLines("trails", [169.25, -44.06], [169.26, -44.05]),
    ).toEqual([]);
    expect(fetched.calls).toEqual([]);
  });

  // Mutation: take the first saved clip in place of `regionCovering`'s, and a
  // clip of another archive (or of none) answers instead of the CDN; skip the
  // saved clip, and a saved area snaps only with a signal.
  it("reads a saved clip of the region's archive, and no other", async () => {
    await collectSnapLines("trails", FROM, TO, [clip(NSW_PATH)]);
    expect(fetched.calls).toHaveLength(1);
    expect((fetched.calls[0] as { getKey: () => string }).getKey()).toBe(
      "file:///files/c.pmtiles",
    );
    fetched.calls = [];
    await collectSnapLines("trails", FROM, TO, [
      clip("master/basemap/protomaps-other.pmtiles"),
      clip(null),
    ]);
    expect(fetched.calls).toEqual([`https://cdn.test/${NSW_PATH}`]);
  });
});
