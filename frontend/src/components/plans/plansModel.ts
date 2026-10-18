// The pure decisions of Plans' forms, out of the components so a test can
// hold them (frontend/DESIGN.md §4): an edit sends only what changed, each as
// the value last seen and the new one (shared/DESIGN.md §10).
import type {
  TripPlanAnswers,
  TripPlanCreate,
  TripPlanFormCreate,
  TripPlanFormPatch,
  TripPlanQuestion,
  TripPlanPatch,
  TripPlanSectionPatch,
} from "@logjam/shared";

export type PlanValues = Required<TripPlanCreate>;
export type SectionValues = { title: string; body: string };
export type FormValues = Required<TripPlanFormCreate>;

/** Only the fields that changed, each as a compare-and-set pair. */
export function planPatch(was: PlanValues, now: PlanValues): TripPlanPatch {
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
export function sectionPatch(
  seen: SectionValues,
  now: SectionValues,
): TripPlanSectionPatch {
  const patch: TripPlanSectionPatch = {};
  if (now.title !== seen.title)
    patch.title = { from: seen.title, to: now.title };
  if (now.body !== seen.body) patch.body = { from: seen.body, to: now.body };
  return patch;
}

export const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Whether "In the plan now" shows under `fields`: the user's value differs
 * from what the plan now holds, and the plan changed it since the form
 * opened. A field only one of them changed has nothing to show.
 */
export function theirsChanged<T extends Record<string, unknown>>(
  opened: T,
  current: T,
  values: T,
  fields: readonly (keyof T)[],
): boolean {
  return fields.some(
    (field) =>
      !same(values[field], current[field]) &&
      !same(current[field], opened[field]),
  );
}

/** A plan's dates are one compare-and-set pair (`planPatch`), so they are
 *  adopted together: one edited date keeps both of the user's. */
export const PLAN_FIELD_GROUPS = [["startDate", "endDate"]] as const;

/**
 * A form's fields after the plan was fetched again (a 409, or a failed save
 * followed by someone else's change): every field the user has not touched
 * takes the plan's current value, and the new baseline is the plan's. A
 * field they did edit keeps their words, and a save compares it with what
 * the plan now holds, so nothing of anyone else's is sent back unseen.
 * Fields in one of `groups` go together, as the API compares them.
 */
export function adoptTheirs<T extends Record<string, unknown>>(
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
    if (unit.every((key) => same(values[key], seen[key])))
      for (const key of unit) merged[key] = current[key];
  return { seen: current, values: merged };
}

/** A form being filled in: what each control holds. A number is the text in
 *  its field, a yes or no the chip's "true" or "false", an agree box a
 *  boolean. */
export type AnswerDraft = Record<string, string | string[] | boolean>;

export function draftFromAnswers(
  questions: readonly TripPlanQuestion[],
  answers: TripPlanAnswers,
): AnswerDraft {
  const draft: AnswerDraft = {};
  for (const question of questions) {
    const value = answers[question.id];
    if (value === undefined) continue;
    draft[question.id] =
      question.kind === "agree"
        ? value === true
        : typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : value;
  }
  return draft;
}

/** The draft as the wire takes it; an empty control says nothing. The shared
 *  parser then trims, caps and checks what is required. */
export function answersFromDraft(
  questions: readonly TripPlanQuestion[],
  draft: AnswerDraft,
): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const question of questions) {
    const value = draft[question.id];
    if (value === undefined || value === "" || value === false) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    answers[question.id] =
      question.kind === "number"
        ? Number(value)
        : question.kind === "yesNo"
          ? value === "true"
          : value;
  }
  return answers;
}

/** A form's changed parts; the questions compare as one list (design §4). */
export function formPatch(
  seen: FormValues,
  now: FormValues,
): TripPlanFormPatch {
  const patch: TripPlanFormPatch = {};
  if (now.title !== seen.title)
    patch.title = { from: seen.title, to: now.title };
  if (JSON.stringify(now.questions) !== JSON.stringify(seen.questions))
    patch.questions = { from: seen.questions, to: now.questions };
  if (now.visibleTo !== seen.visibleTo)
    patch.visibleTo = { from: seen.visibleTo, to: now.visibleTo };
  if (now.requiredToJoin !== seen.requiredToJoin)
    patch.requiredToJoin = {
      from: seen.requiredToJoin,
      to: now.requiredToJoin,
    };
  return patch;
}

/** A new question's or option's id: stable across edits, unique in its form,
 *  a slug no plain object already has as a key (`q3f9a…`). */
export function mintSlug(prefix: "q" | "o"): string {
  return `${prefix}${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}
