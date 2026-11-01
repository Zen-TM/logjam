// Bulk actions on the plans list. A selection mixes roles, and one button acts
// on each plan as its role allows: the plans you lead are deleted, the rest
// are left. Only a leader archives. No endpoint of its own: each plan goes
// through the same call its own page uses.
import type { TripPlanSummary } from "@logjam/shared";

type Pickable = Pick<TripPlanSummary, "status" | "role">;

/** A plan you are in; an invite or a request has nothing to select it for. */
export const planSelectable = (plan: Pickable) => plan.status === "active";

export function planBulkSplit<P extends Pickable>(plans: readonly P[]) {
  return {
    lead: plans.filter((plan) => plan.role === "leader"),
    leave: plans.filter((plan) => plan.role !== "leader"),
  };
}
