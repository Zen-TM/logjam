import { describe, expect, it } from "vitest";

import { groupUnfinishedRegions } from "./unfinishedRegionGroups";
import type { UnfinishedRegion } from "./regionMbtiles";

function region(
  id: string,
  groupId: string | undefined,
  tilesStored: number,
): UnfinishedRegion {
  return {
    id,
    label: "SIX Maps Topo",
    groupId,
    groupLabel: groupId ? "Region 3" : undefined,
    basemapId: "six-topo",
    bbox: { west: 150, south: -34, east: 151, north: -33 },
    zMin: 8,
    zMax: 14,
    tilesStored,
  };
}

describe("groupUnfinishedRegions", () => {
  it("lists an area's unfinished files as ONE row, not one per file", () => {
    const rows = groupUnfinishedRegions([
      region("a", "g1", 10),
      region("b", "g1", 20),
      region("c", "g1", 30),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      groupId: "g1",
      label: "Region 3",
      tilesStored: 60,
    });
    expect(rows[0].regions.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps separate areas apart and a file with no group stands alone", () => {
    const rows = groupUnfinishedRegions([
      region("a", "g1", 1),
      region("b", "g2", 1),
      region("legacy", undefined, 1),
    ]);
    expect(rows.map((r) => r.groupId)).toEqual(["g1", "g2", "legacy"]);
    expect(rows[2].label).toBe("SIX Maps Topo");
  });
});
