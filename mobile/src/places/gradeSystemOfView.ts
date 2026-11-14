import {
  gradeSystemAt,
  REGIONS,
  type CanyonGradeSystem,
  type Region,
} from "@logjam/shared";

import { homeView } from "../map/mapChrome";

/**
 * The grade system of the ground the map is looking at, for a list that sorts
 * by it: that of the region under the camera's centre, and before the map has
 * settled once (`center` null), of the account's opening view. Guard:
 * `gradeSystemOfView.test.ts`.
 */
export function gradeSystemOfView(
  center: readonly [number, number] | null,
  regionIds: readonly string[],
  regions: readonly Region[] = REGIONS,
): CanyonGradeSystem {
  const [lon, lat] = center ?? homeView(regionIds, regions).center;
  return gradeSystemAt(lon, lat, regions);
}
