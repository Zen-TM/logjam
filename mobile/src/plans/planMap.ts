// Plan mode on the map (design §8): what the map frames when a plan opens on
// it. Built at navigation time and never stored, like a place's focus: a
// region of interest stays off the server (mobile/AGENTS.md).
import type { TripPlanView } from "@logjam/shared";

/** At least this much on each side, so one place frames ground, not a pixel. */
const MIN_HALF_SPAN = 0.005;

/** The plan's places and ways, as `[west, south, east, north]`, or null. */
export function planBbox(
  plan: Pick<TripPlanView, "places" | "routes">,
): [number, number, number, number] | null {
  const points: [number, number][] = [
    ...plan.places.map(
      (place) => [place.longitude, place.latitude] as [number, number],
    ),
    ...plan.routes.flatMap((route) => route.points),
  ];
  if (points.length === 0) return null;
  const lons = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  const pad = (low: number, high: number): [number, number] => {
    const mid = (low + high) / 2;
    const half = Math.max((high - low) / 2, MIN_HALF_SPAN);
    return [mid - half, mid + half];
  };
  const [west, east] = pad(Math.min(...lons), Math.max(...lons));
  const [south, north] = pad(Math.min(...lats), Math.max(...lats));
  return [west, south, east, north];
}
