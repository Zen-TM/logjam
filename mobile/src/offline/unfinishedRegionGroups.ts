// Half-written region files with no job in the queue, as ONE row per area.
//
// A run writes a file per basemap (plus the DEM), all sharing a `groupId`. The
// Saved screen listed each file, so one interrupted area showed as three rows
// under the same name. The user asked for an area; the files are its parts.
import type { UnfinishedRegion } from "./regionMbtiles";

export type UnfinishedRegionGroup = {
  groupId: string;
  /** The name the user gave the area; a legacy file falls back to its own. */
  label: string;
  tilesStored: number;
  regions: UnfinishedRegion[];
};

export function groupUnfinishedRegions(
  regions: UnfinishedRegion[],
): UnfinishedRegionGroup[] {
  const groups = new Map<string, UnfinishedRegionGroup>();
  for (const region of regions) {
    // Same key the queue and the finished artifacts use, so a resume lands
    // back in the area it came from.
    const groupId = region.groupId ?? region.id;
    const group = groups.get(groupId);
    if (group) {
      group.regions.push(region);
      group.tilesStored += region.tilesStored;
    } else {
      groups.set(groupId, {
        groupId,
        label: region.groupLabel ?? region.label,
        tilesStored: region.tilesStored,
        regions: [region],
      });
    }
  }
  return [...groups.values()];
}
