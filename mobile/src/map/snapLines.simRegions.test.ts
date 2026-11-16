// A segment in a simulated region snaps to that region's archive, and a saved
// clip of another region's archive does not answer for it. Its own file because
// the simulated regions are a module-load switch (`simRegionsOn`), and
// `snapLines.test.ts` holds what happens with only NSW.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as { LOGJAM_SIM_REGIONS?: boolean }).LOGJAM_SIM_REGIONS = true;
});
const fetched = vi.hoisted(() => ({ calls: [] as unknown[] }));
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
const { SIM_NZ, NSW_REGION } = await import("@logjam/shared");

const nsw = NSW_REGION.vector!.archivePath;
const NZ_FROM: [number, number] = [169.25, -44.06];
const NZ_TO: [number, number] = [169.26, -44.05];
const clip = (archivePath: string) => ({
  id: "c",
  kind: "basemap-region" as const,
  logicalKey: "protomaps",
  format: "pmtiles" as const,
  sourceType: "vector" as const,
  path: "/files/c.pmtiles",
  bbox: [169, -45, 170, -44] as [number, number, number, number],
  minzoom: 0,
  maxzoom: 15,
  sizeBytes: 1,
  downloadedAt: "2026-11-16T00:00:00.000Z",
  archivePath,
});

beforeEach(() => {
  fetched.calls = [];
});

describe("collectSnapLines with the simulated regions on", () => {
  // Mutation: pass NSW's path to `regionCovering` or `archiveUrl` in place of
  // the segment's region's, and a segment in simulated New Zealand reads
  // NSW's archive, or snaps to a clip of it that holds no ways there.
  it("reads the archive of the region the segment is in", async () => {
    await collectSnapLines("trails", NZ_FROM, NZ_TO, [clip(nsw)]);
    expect(fetched.calls).toEqual([
      `https://cdn.test/${SIM_NZ.vector!.archivePath}`,
    ]);
    fetched.calls = [];
    await collectSnapLines("trails", NZ_FROM, NZ_TO, [
      clip(SIM_NZ.vector!.archivePath),
    ]);
    expect((fetched.calls[0] as { getKey: () => string }).getKey()).toBe(
      "file:///files/c.pmtiles",
    );
  });
});
