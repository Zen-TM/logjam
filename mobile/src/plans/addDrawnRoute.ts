// A route drawn from a plan's page goes into that plan once it is on the
// server: the route was saved on the phone first, so the sync runs before the
// plan is asked for it (the API 404s a route it has not seen).
import { pendingCreateIds } from "../sync/outbox";
import { requestSync } from "../sync/syncEngine";
import { addPlanItem } from "./plansApi";
import { afterPlanWrite } from "./plansCache";

/** True once the route is in the plan; false when it could not be (offline,
 *  or the sync did not land): the route itself stays saved. */
export async function addDrawnRouteToPlan(
  planId: string,
  routeId: string,
): Promise<boolean> {
  try {
    await requestSync();
    if ((await pendingCreateIds()).has(routeId)) return false;
    await addPlanItem(planId, { kind: "route", id: routeId });
    await afterPlanWrite(planId);
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}
