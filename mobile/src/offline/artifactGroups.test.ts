import { describe, expect, it } from "vitest";

import {
  groupArtifacts,
  overlayJobId,
  regionGroupKey,
  unionBbox,
  type Bbox,
} from "./artifactGroups";
import type { MapArtifact } from "../map/sourceResolver";

function artifact(overrides: Partial<MapArtifact> & { id: string }): MapArtifact {
  return {
    kind: "basemap-region",
    logicalKey: "six-topo",
    format: "mbtiles",
    sourceType: "raster",
    path: `/tmp/${overrides.id}`,
    bbox: null,
    minzoom: null,
    maxzoom: null,
    sizeBytes: 0,
    downloadedAt: "2026-08-16T00:00:00.000Z",
    ...overrides,
  };
}

describe("group keys", () => {
  it("groups a run's rows together and leaves legacy rows standing alone", () => {
    expect(regionGroupKey(artifact({ id: "a", groupId: "run-1" }))).toBe("run-1");
    expect(regionGroupKey(artifact({ id: "a" }))).toBe("a");
  });

  it("takes a topo overlay's job id off its logicalKey", () => {
    expect(overlayJobId(artifact({ id: "a", logicalKey: "job-9/contours" }))).toBe("job-9");
    // Defensive: a key with no layer suffix is its own job rather than a crash.
    expect(overlayJobId(artifact({ id: "a", logicalKey: "job-9" }))).toBe("job-9");
  });
});

describe("unionBbox", () => {
  it("returns null when nothing has an extent", () => {
    expect(unionBbox([null, undefined])).toBeNull();
  });

  it("covers every box given", () => {
    const a: Bbox = [150, -34, 151, -33];
    const b: Bbox = [149.5, -33.5, 150.5, -32];
    expect(unionBbox([a, null, b])).toEqual([149.5, -34, 151, -32]);
  });
});

describe("groupArtifacts", () => {
  it("sums sizes, unions extents and keeps arrival order", () => {
    const groups = groupArtifacts(
      [
        artifact({ id: "1", groupId: "run-1", groupLabel: "Blue Gum", sizeBytes: 10, bbox: [150, -34, 151, -33] }),
        artifact({ id: "2", sizeBytes: 5 }),
        artifact({ id: "3", groupId: "run-1", groupLabel: "Blue Gum", sizeBytes: 7, bbox: [149, -34, 150, -33] }),
      ],
      regionGroupKey,
    );
    expect(groups.map((g) => g.key)).toEqual(["run-1", "2"]);
    expect(groups[0].sizeBytes).toBe(17);
    expect(groups[0].members).toHaveLength(2);
    expect(groups[0].bbox).toEqual([149, -34, 151, -33]);
    expect(groups[0].label).toBe("Blue Gum");
  });

  it("prefers the group name over a single row's rename, and falls back to it", () => {
    const [named] = groupArtifacts(
      [artifact({ id: "1", groupId: "r", label: "row name", groupLabel: "area name" })],
      regionGroupKey,
    );
    expect(named.label).toBe("area name");
    const [legacy] = groupArtifacts([artifact({ id: "1", label: "row name" })], regionGroupKey);
    expect(legacy.label).toBe("row name");
    const [anonymous] = groupArtifacts([artifact({ id: "1" })], regionGroupKey);
    expect(anonymous.label).toBeNull();
  });
});
