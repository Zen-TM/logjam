// Bulk actions on the plans list: what a selection offers is shared
// (`tripPlanBulkOffers`). No endpoint of its own: each plan goes through the
// same call its own page uses.
import type { TripPlanSummary } from "@logjam/shared";

type Pickable = Pick<TripPlanSummary, "status" | "role">;

/** A plan you are in; an invite or a request has nothing to select it for. */
export const planSelectable = (plan: Pickable) => plan.status === "active";
