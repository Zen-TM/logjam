// Whether a saved map region already holds a place's or a way's ground, for the
// coverage line on their pages and the plan's "Map downloaded" pill.
import type { MapArtifact } from "../map/sourceResolver";

type Bbox = [number, number, number, number];

/** Whether ONE saved region holds the whole of `bbox` (west, south, east,
 *  north), edges included. */
// ponytail: two regions that tile the area together still read as not covered;
// a union check if that turns up.
export function coveredByOfflineMaps(
  bbox: Bbox,
  regions: readonly Pick<MapArtifact, "kind" | "bbox">[],
): boolean {
  const [west, south, east, north] = bbox;
  return regions.some(
    ({ kind, bbox: region }) =>
      kind === "basemap-region" &&
      region !== null &&
      region[0] <= west &&
      region[1] <= south &&
      region[2] >= east &&
      region[3] >= north,
  );
}
