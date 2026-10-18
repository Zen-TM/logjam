// Plans (#439): the words the TripPlan tables store. The columns are plain
// strings, not Postgres enums, so a new word needs no migration; this file
// is the only list, and the API validates every write against it.

/** What a member may do in a plan. A plan can have more than one leader. */
export const TRIP_PLAN_ROLES = ["leader", "editor", "member"] as const;
export type TripPlanRole = (typeof TRIP_PLAN_ROLES)[number];

/**
 * Where a membership stands. "invited": a leader named them by username and
 * they have not joined yet. "requested": they used a link and wait for a
 * leader's approval. "active": in the plan.
 */
export const TRIP_PLAN_MEMBER_STATUSES = [
  "invited",
  "requested",
  "active",
] as const;
export type TripPlanMemberStatus = (typeof TRIP_PLAN_MEMBER_STATUSES)[number];

/** Who may read the answers to a form. */
export const TRIP_PLAN_FORM_VISIBILITIES = ["leaders", "members"] as const;
export type TripPlanFormVisibility =
  (typeof TRIP_PLAN_FORM_VISIBILITIES)[number];

function oneOf<T extends string>(words: readonly T[]) {
  return (value: unknown): value is T =>
    typeof value === "string" && (words as readonly string[]).includes(value);
}

export const isTripPlanRole = oneOf(TRIP_PLAN_ROLES);
export const isTripPlanMemberStatus = oneOf(TRIP_PLAN_MEMBER_STATUSES);
export const isTripPlanFormVisibility = oneOf(TRIP_PLAN_FORM_VISIBILITIES);
