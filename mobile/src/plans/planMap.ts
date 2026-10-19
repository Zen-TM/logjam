// Plan mode on the map: what the map frames when a plan opens on it. Built at
// navigation time and never stored, like a place's focus: a region of
// interest stays off the server (mobile/AGENTS.md).
import type { TripPlanView } from "@logjam/shared";

import { bboxOfPoints, PLACE_FOCUS_DEGREES } from "../saved/bboxOfPoints";

/** The plan's places and ways, as `[west, south, east, north]`, or null. At
 *  least a place's frame on each axis, so places metres apart frame ground as
 *  one place's Show on map does. */
export function planBbox(
  plan: Pick<TripPlanView, "places" | "routes">,
): [number, number, number, number] | null {
  const box = bboxOfPoints([
    ...plan.places.map((place) => ({
      lon: place.longitude,
      lat: place.latitude,
    })),
    ...plan.routes.flatMap((route) =>
      route.points.map(([lon, lat]) => ({ lon, lat })),
    ),
  ]);
  if (!box) return null;
  const widen = (low: number, high: number): [number, number] => {
    const mid = (low + high) / 2;
    const half = Math.max((high - low) / 2, PLACE_FOCUS_DEGREES);
    return [mid - half, mid + half];
  };
  const [west, east] = widen(box[0], box[2]);
  const [south, north] = widen(box[1], box[3]);
  return [west, south, east, north];
}
