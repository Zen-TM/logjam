// The add verbs that put a place or way in the plan, as the Map view's
// buttons: which a role is offered on Logjam GPS, in menu order.
import {
  PLAN_ADD_VERBS,
  PLAN_ITEM_ADD_VERBS,
  planVerbsFor,
  type PlanAddVerbId,
  type PlanVerb,
  type TripPlanRole,
} from "@logjam/shared";

export function itemAddVerbs(
  role: TripPlanRole,
  archived: boolean,
): PlanVerb<PlanAddVerbId>[] {
  return (
    planVerbsFor(PLAN_ADD_VERBS, "gps", role, {
      archived,
    }) as PlanVerb<PlanAddVerbId>[]
  ).filter((verb) =>
    (PLAN_ITEM_ADD_VERBS as readonly string[]).includes(verb.id),
  );
}
