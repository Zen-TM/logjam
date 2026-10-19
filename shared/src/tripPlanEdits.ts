// The edits both clients' plan forms send: only what changed, each as the
// value last seen and the new one (shared/DESIGN.md §10), and what a form
// keeps when the plan is fetched again under it.
import type {
  TripPlanCreate,
  TripPlanPatch,
  TripPlanSectionPatch,
} from "./tripPlans.js";

export type TripPlanValues = Required<TripPlanCreate>;
export type TripPlanSectionValues = { title: string; body: string };

/** Only the fields that changed, each as a compare-and-set pair. */
export function tripPlanPatch(
  was: TripPlanValues,
  now: TripPlanValues,
): TripPlanPatch {
  const patch: TripPlanPatch = {};
  if (now.name !== was.name) patch.name = { from: was.name, to: now.name };
  if (now.startDate !== was.startDate || now.endDate !== was.endDate)
    patch.dates = {
      from: { startDate: was.startDate, endDate: was.endDate },
      to: { startDate: now.startDate, endDate: now.endDate },
    };
  if (now.tripTypes.join("\n") !== was.tripTypes.join("\n"))
    patch.tripTypes = { from: was.tripTypes, to: now.tripTypes };
  return patch;
}

/** Only what changed, against what the form last saw of the plan. */
export function tripPlanSectionPatch(
  seen: TripPlanSectionValues,
  now: TripPlanSectionValues,
): TripPlanSectionPatch {
  const patch: TripPlanSectionPatch = {};
  if (now.title !== seen.title)
    patch.title = { from: seen.title, to: now.title };
  if (now.body !== seen.body) patch.body = { from: seen.body, to: now.body };
  return patch;
}

export const tripPlanSame = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** A plan's dates are one compare-and-set pair (`tripPlanPatch`), so they
 *  are adopted together: one edited date keeps both of the user's. */
export const TRIP_PLAN_FIELD_GROUPS = [["startDate", "endDate"]] as const;

/**
 * A form's fields after the plan was fetched again (a 409, or a failed save
 * followed by someone else's change): every field the user has not touched
 * takes the plan's current value, and the new baseline is the plan's. A
 * field they did edit keeps their words, and a save compares it with what
 * the plan now holds. Fields in one of `groups` go together, as the API
 * compares them. The form shows the plan's value under an edited field it
 * changed (`tripPlanInPlanNow`).
 */
export function tripPlanAdoptTheirs<T extends Record<string, unknown>>(
  seen: T,
  values: T,
  current: T,
  groups: readonly (readonly (keyof T)[])[] = [],
): { seen: T; values: T } {
  const merged = { ...values };
  const grouped = new Set(groups.flat());
  const units = [
    ...groups,
    ...(Object.keys(current) as (keyof T)[])
      .filter((key) => !grouped.has(key))
      .map((key) => [key]),
  ];
  for (const unit of units)
    if (unit.every((key) => tripPlanSame(values[key], seen[key])))
      for (const key of unit) merged[key] = current[key];
  return { seen: current, values: merged };
}
