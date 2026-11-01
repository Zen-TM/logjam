// The edits both clients' plan forms send: only what changed, each as the
// value last seen and the new one (shared/DESIGN.md §10), and what a form
// keeps when the plan is fetched again under it.
import type {
  TripPlanCreate,
  TripPlanFormCreate,
  TripPlanFormPatch,
  TripPlanQuestion,
  TripPlanQuestionKind,
  TripPlanPatch,
  TripPlanSectionPatch,
} from "./tripPlans.js";
import { sameValue } from "./planItemEdit.js";

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

/** Key order aside (`sameValue`): JSONB hands a question list back in
 *  Postgres's key order, which is not the order it was sent in. */
export const tripPlanSame = sameValue;

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

/**
 * Whether a form shows the plan's value ("In the plan now: …") under these
 * fields: the user edited one of them, and the plan changed it since the
 * form opened. An untouched field already shows the plan's value.
 */
export function tripPlanTheirsChanged<T extends Record<string, unknown>>(
  fields: readonly (keyof T)[],
  values: T,
  current: T,
  opened: T,
): boolean {
  return fields.some(
    (field) =>
      !tripPlanSame(values[field], current[field]) &&
      !tripPlanSame(current[field], opened[field]),
  );
}

export type TripPlanFormValues = Required<TripPlanFormCreate>;

/** A form's changed parts; the questions compare as one list, as the API
 *  compares them. */
export function tripPlanFormPatch(
  seen: TripPlanFormValues,
  now: TripPlanFormValues,
): TripPlanFormPatch {
  const patch: TripPlanFormPatch = {};
  if (now.title !== seen.title)
    patch.title = { from: seen.title, to: now.title };
  if (!tripPlanSame(now.questions, seen.questions))
    patch.questions = { from: seen.questions, to: now.questions };
  if (now.visibleTo !== seen.visibleTo)
    patch.visibleTo = { from: seen.visibleTo, to: now.visibleTo };
  return patch;
}

/** A new question's or option's id: unique in its form, a slug no plain
 *  object already has as a key. `random` is injectable for tests. */
export function tripPlanMintSlug(
  prefix: "q" | "o",
  random: () => number = Math.random,
): string {
  return `${prefix}${random().toString(36).slice(2, 14).padEnd(8, "0")}`;
}

export const tripPlanKindHasOptions = (kind: TripPlanQuestionKind) =>
  kind === "choice" || kind === "multiChoice";

/** A question after its kind changed: a choice starts with two options to
 *  fill in, any other kind has none. */
export function tripPlanQuestionKindChanged(
  question: TripPlanQuestion,
  kind: TripPlanQuestionKind,
): TripPlanQuestion {
  const { options, ...rest } = question;
  return tripPlanKindHasOptions(kind)
    ? {
        ...rest,
        kind,
        options: options ?? [
          { id: tripPlanMintSlug("o"), label: "" },
          { id: tripPlanMintSlug("o"), label: "" },
        ],
      }
    : { ...rest, kind };
}

export const tripPlanBlankQuestion = (): TripPlanQuestion => ({
  id: tripPlanMintSlug("q"),
  kind: "text",
  label: "",
  required: false,
});

/** A blank form: one empty question, answers seen by leaders. */
export const tripPlanBlankForm = (): TripPlanFormValues => ({
  title: "",
  preset: null,
  visibleTo: "leaders",
  questions: [tripPlanBlankQuestion()],
});
