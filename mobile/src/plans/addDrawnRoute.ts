// A route drawn from a plan's page is made in the plan and in no account:
// the points go straight to the plan (POST /plans/:id/items, `new`), so
// nothing is saved on the phone and, offline, the save fails with the draft
// still on the map.
import type { TripPlanNewRoute } from "@logjam/shared";

import { addPlanItem } from "./plansApi";
import { afterPlanWrite } from "./plansCache";

/** Where a drawn route is saved: an edit keeps its own, a draw from a place's
 *  page fills its slot, one from a plan's page goes into the plan, else the
 *  account. */
export function drawnRouteTarget(draw: {
  editingRouteId: string | null;
  placeId: string | null;
  planId: string | null;
}): "edit" | "place" | "plan" | "account" {
  if (draw.editingRouteId) return "edit";
  if (draw.placeId) return "place";
  return draw.planId ? "plan" : "account";
}

/** Throws when the plan refuses it or there is no connection. */
export async function addDrawnRouteToPlan(
  planId: string,
  route: TripPlanNewRoute,
): Promise<void> {
  await addPlanItem(planId, { kind: "route", new: route });
  await afterPlanWrite(planId);
}
