import { planVerbsFor, PLAN_VERBS, type TripPlanSummary } from "@logjam/shared";

export type ListVerbId = "archive" | "unarchive" | "leave" | "delete";

/**
 * The plan's verbs a card can run without opening it (the rest need the plan
 * loaded): a leader deletes, anyone else leaves. The API refuses a sole
 * leader's leave, which a leader has no card verb for anyway.
 */
export function listVerbs(plan: TripPlanSummary) {
  const archived = plan.archivedAt != null;
  return planVerbsFor(PLAN_VERBS, "web", plan.role, { archived }).filter(
    (verb): verb is typeof verb & { id: ListVerbId } =>
      (verb.id === "archive" ||
        verb.id === "unarchive" ||
        verb.id === "delete" ||
        verb.id === "leave") &&
      verb.id !== (archived ? "archive" : "unarchive") &&
      (verb.id !== "leave" || plan.role !== "leader"),
  );
}

/** What a selection can all do: the verbs every picked plan has. */
export function bulkVerbs(plans: TripPlanSummary[]) {
  if (plans.length === 0) return [];
  const [first, ...rest] = plans.map(listVerbs);
  return first.filter((verb) =>
    rest.every((verbs) => verbs.some((other) => other.id === verb.id)),
  );
}
