import { describe, expect, it, vi } from "vitest";

import type { MapArtifact } from "../map/sourceResolver";

vi.mock("react-native", () => ({ Alert: { alert: vi.fn() } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "id" }));
vi.mock("@react-native-community/netinfo", () => ({
  default: { fetch: vi.fn() },
}));
vi.mock("./regionDownloadQueue", () => ({ enqueueRegionDownloads: vi.fn() }));
vi.mock("./askMobileData", () => ({ askAllowCellular: vi.fn() }));
vi.mock("./freeSpace", () => ({
  assertSpaceFor: vi.fn(),
  NotEnoughSpaceError: class extends Error {},
}));

const { canUpdateRegion, regionUpdateSpecs, startRegionUpdate } = await import(
  "./regionUpdate"
);
const NetInfo = (await import("@react-native-community/netinfo")).default;
const { askAllowCellular } = await import("./askMobileData");

const BOX: [number, number, number, number] = [150.2, -33.7, 150.3, -33.6];
const member = (extra: Partial<MapArtifact> & { id: string }): MapArtifact => ({
  kind: "basemap-region",
  logicalKey: "six-topo",
  format: "mbtiles",
  sourceType: "raster",
  path: "/x",
  bbox: BOX,
  minzoom: 4,
  maxzoom: 15,
  sizeBytes: 1,
  downloadedAt: "2026-10-03T00:00:00.000Z",
  label: "Topo region",
  groupId: "run-1",
  groupLabel: "Claustral",
  ...extra,
});

describe("regionUpdateSpecs", () => {
  let n = 0;
  const newId = () => `job-${++n}`;
  const members = [
    member({ id: "a" }),
    member({
      id: "b",
      kind: "basemap-region",
      logicalKey: "protomaps",
      format: "pmtiles",
      sourceType: "vector",
      minzoom: 0,
      maxzoom: 15,
    }),
    member({
      id: "c",
      kind: "dem-region",
      logicalKey: "nsw-5m",
      format: "pmtiles",
    }),
    member({
      id: "d",
      kind: "contours-region",
      logicalKey: "nsw-contours",
      format: "pmtiles",
    }),
    // A sharpened area's clip: its bbox is tile-snapped and its link needs the
    // account, so it is neither read nor re-cut.
    member({
      id: "e",
      kind: "dem-region",
      logicalKey: "lidar-abc",
      format: "pmtiles",
      bbox: [150, -34, 151, -33],
    }),
  ];

  // Mutation: build the spec from the group's union bbox, or from the
  // sharpened clip's snapped one, and the update downloads a different area.
  it("asks for the same area, detail, maps and name", () => {
    const specs = regionUpdateSpecs(members, "Claustral", false, newId);
    expect(specs).toHaveLength(4);
    for (const spec of specs ?? []) {
      expect(spec.bbox).toEqual({
        west: 150.2,
        south: -33.7,
        east: 150.3,
        north: -33.6,
      });
      expect(spec.groupId).toBe("run-1");
      expect(spec.groupLabel).toBe("Claustral");
    }
    expect(specs?.[0]).toMatchObject({
      taskKind: "tile-pyramid",
      basemapId: "six-topo",
      zMin: 4,
      zMax: 15,
    });
    expect(specs?.[1]).toMatchObject({
      taskKind: "clip",
      basemapId: "protomaps",
    });
    expect(specs?.[2]).toMatchObject({ demSourceId: "nsw-5m" });
    expect(specs?.[3]).toMatchObject({ contours: true });
  });

  it("has nothing to update when no file knows its area", () => {
    expect(
      regionUpdateSpecs([member({ id: "x", bbox: null })], "A", false, newId),
    ).toBeNull();
  });

  it("gives each job its own id", () => {
    const ids = regionUpdateSpecs(members, "A", false, newId)?.map((s) => s.id);
    expect(new Set(ids).size).toBe(4);
  });
});

describe("a card that cannot be updated", () => {
  const legacy = member({ id: "x", bbox: null });
  const sharpenedOnly = member({
    id: "y",
    kind: "dem-region",
    logicalKey: "lidar-abc",
    format: "pmtiles",
  });

  // Mutation: offer Update on every card and a card with no area answers the
  // data prompt and then does nothing.
  it("is not offered Update, and asks nothing if asked anyway", async () => {
    expect(canUpdateRegion([legacy])).toBe(false);
    expect(canUpdateRegion([sharpenedOnly])).toBe(false);
    expect(canUpdateRegion([member({ id: "z" })])).toBe(true);
    await startRegionUpdate([legacy], "A");
    expect(NetInfo.fetch).not.toHaveBeenCalled();
    expect(askAllowCellular).not.toHaveBeenCalled();
  });
});
