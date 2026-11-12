// Whether saved map regions already hold a place's or a way's ground, for the
// coverage line on their pages and the plan's "Map downloaded" pill.
import type { MapArtifact } from "../map/sourceResolver";

type Bbox = [number, number, number, number];
type Region = Pick<MapArtifact, "kind" | "bbox">;
type Point = [lon: number, lat: number];

/** The longest stretch of a way checked in one step, in degrees (~1 km). */
const LEG_STEP_DEGREES = 0.01;

const holds = (region: Bbox, [lon, lat]: Point) =>
  region[0] <= lon && region[1] <= lat && region[2] >= lon && region[3] >= lat;

function savedBoxes(regions: readonly Region[]): Bbox[] {
  return regions.flatMap(({ kind, bbox }) =>
    kind === "basemap-region" && bbox ? [bbox] : [],
  );
}

/** Whether `bbox` (west, south, east, north, edges included) is held by one
 *  saved region, or by several that together hold its corners and centre. */
// ponytail: five points, so a hole between regions that misses all of them
// still reads as covered; a tile-grid check if that turns up.
export function coveredByOfflineMaps(
  bbox: Bbox,
  regions: readonly Region[],
): boolean {
  const [west, south, east, north] = bbox;
  const boxes = savedBoxes(regions);
  if (
    boxes.some(
      (box) =>
        box[0] <= west && box[1] <= south && box[2] >= east && box[3] >= north,
    )
  )
    return true;
  const samples: Point[] = [
    [west, south],
    [west, north],
    [east, south],
    [east, north],
    [(west + east) / 2, (south + north) / 2],
  ];
  return samples.every((point) => boxes.some((box) => holds(box, point)));
}

/** Whether every point along a way lies in some saved region: each vertex, and
 *  evenly spaced points on any leg longer than a step, so two regions that
 *  tile the way together count. */
export function routeCoveredByOfflineMaps(
  points: readonly Point[],
  regions: readonly Region[],
): boolean {
  const boxes = savedBoxes(regions);
  const covered = (point: Point) => boxes.some((box) => holds(box, point));
  for (let i = 0; i < points.length; i++) {
    if (!covered(points[i])) return false;
    if (i === 0) continue;
    const [lon0, lat0] = points[i - 1];
    const [lon1, lat1] = points[i];
    const parts = Math.ceil(
      Math.max(Math.abs(lon1 - lon0), Math.abs(lat1 - lat0)) / LEG_STEP_DEGREES,
    );
    for (let part = 1; part < parts; part++) {
      const t = part / parts;
      if (!covered([lon0 + (lon1 - lon0) * t, lat0 + (lat1 - lat0) * t]))
        return false;
    }
  }
  return points.length > 0;
}
