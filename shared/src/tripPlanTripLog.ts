import { tripPlanInPlanIds } from "./contracts/plans.js";
import type { TripPlanPlace } from "./tripPlans.js";

/**
 * Start a trip log's places: each plan place paired with the caller's own
 * place of the same name and coordinates (`tripPlanInPlanIds` run the other
 * way), in the plan's order. A trip links only its owner's places, and a plan
 * place is no one's, so one with no match of the caller's is left out: nothing
 * is copied. A renamed or moved place no longer matches; with two of the same
 * name and spot the first of `own` is linked. Both clients run it. Guard:
 * tripPlanTripLog.test.ts.
 */
export function tripPlanTripLogMatches<
  O extends { id: string; name: string; latitude: number; longitude: number },
>(planPlaces: readonly TripPlanPlace[], own: readonly O[]) {
  return planPlaces.flatMap((place) => {
    const ids = tripPlanInPlanIds(
      { places: [place], routes: [], files: [] },
      { places: [...own], routes: [], files: [] },
    );
    const mine = own.find((p) => ids.has(p.id));
    return mine ? [{ place, own: mine }] : [];
  });
}
