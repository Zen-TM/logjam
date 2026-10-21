// The pure decisions of Plans' forms, out of the components so a test can
// hold them (frontend/DESIGN.md §4): an edit sends only what changed, each as
// the value last seen and the new one (shared/DESIGN.md §10).
import {
  answersFromDraft,
  currentTripPlanAnswers,
  TRIP_PLAN_FORM_PRESETS,
  TRIP_PLAN_PRINTED_COLUMNS,
  TRIP_PLAN_PRINTED_PRESETS,
  parseTripPlanAnswers,
  tripPlanAnswerText,
  tripPlanRoleWord,
} from "@logjam/shared";
import type {
  TripPlanCreate,
  TripPlanFormCreate,
  TripPlanFormPatch,
  TripPlanFormPresetId,
  TripPlanAnswerDraft,
  TripPlanFormView,
  TripPlanJoinAnswers,
  TripPlanJoinForm,
  TripPlanMemberStatus,
  TripPlanPatch,
  TripPlanSectionPatch,
  TripPlanView,
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

/** Key order aside: a form's questions come back from a JSONB column in
 *  Postgres's key order, not the order the shared parser builds them in. */
const sorted = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sorted)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([key, each]) => [key, sorted(each)]),
        )
      : value;

export const same = (a: unknown, b: unknown) =>
  JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

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

/** A form's changed parts; the questions compare as one list, as the API
 *  compares them. */
export function formPatch(
  seen: FormValues,
  now: FormValues,
): TripPlanFormPatch {
  const patch: TripPlanFormPatch = {};
  if (now.title !== seen.title)
    patch.title = { from: seen.title, to: now.title };
  if (!same(now.questions, seen.questions))
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

export type SummaryParts = {
  writeUp: boolean;
  going: boolean;
  /** The printable forms ticked, by preset. */
  presets: readonly TripPlanFormPresetId[];
};

/** The preset forms the summary may print: those everyone in the plan
 *  sees, whose fillers were told members may print them
 *  (`tripPlanVisibilityLine`), one per printed preset. */
export function summaryForms(
  plan: Pick<TripPlanView, "forms">,
): (TripPlanFormView & { preset: TripPlanFormPresetId })[] {
  return TRIP_PLAN_PRINTED_PRESETS.flatMap((preset) => {
    const form = plan.forms.find(
      (each) => each.preset === preset && each.visibleTo === "members",
    );
    return form ? [{ ...form, preset }] : [];
  });
}

/** One table of a preset form's answers: a row per person going who
 *  answered, a column per question the preset prints that is still its
 *  kind, headed by its label now. A question a leader removed, or turned
 *  into something else ("Medications"), is not printed. */
function answerTable(
  form: TripPlanFormView & { preset: TripPlanFormPresetId },
  going: ReadonlySet<string>,
) {
  const preset = TRIP_PLAN_FORM_PRESETS[form.preset];
  const columns = (TRIP_PLAN_PRINTED_COLUMNS[form.preset] ?? []).flatMap(
    (id) => {
      const question = form.questions.find((each) => each.id === id);
      const was = preset.questions.find((each) => each.id === id);
      return question && question.kind === was?.kind ? [question] : [];
    },
  );
  if (columns.length === 0) return [];
  const answers = [...form.answers, ...(form.myAnswer ? [form.myAnswer] : [])];
  const rows = answers
    .filter((answer) => going.has(answer.user.id))
    .map((answer) => {
      const values = currentTripPlanAnswers(form.questions, answer.answers);
      return [
        answer.user.username,
        ...columns.map((question) =>
          tripPlanAnswerText(question, values[question.id]),
        ),
      ];
    })
    .sort((a, b) => a[0].localeCompare(b[0]));
  return [
    {
      preset: form.preset,
      caption: preset.title,
      head: ["Name", ...columns.map((each) => each.label)],
      rows,
    },
  ];
}

/**
 * What the print summary holds, for someone not on the trip.
 * PRIVACY: never a place, a coordinate, a way, a map, another form, anyone's
 * medical answers or anyone not going: only the write-up, who's going, and
 * the printed presets' named questions (`TRIP_PLAN_PRINTED_COLUMNS`), from
 * forms everyone in the plan sees. Guard: plansModel.test.ts.
 */
export function planSummary(plan: TripPlanView, parts: SummaryParts) {
  const active = plan.members.filter((member) => member.status === "active");
  const going = new Set(active.map((member) => member.user.id));
  return {
    name: plan.name,
    leaders: active
      .filter((member) => member.role === "leader")
      .map((member) => member.user.username),
    sections: parts.writeUp
      ? plan.sections.map(({ title, body }) => ({ title, body }))
      : [],
    going: parts.going
      ? active.map((member) => [
          member.user.username,
          tripPlanRoleWord(member.role),
        ])
      : [],
    tables: summaryForms(plan)
      .filter((form) => parts.presets.includes(form.preset))
      .flatMap((form) => answerTable(form, going)),
  };
}

/** Whether a plan opens as an invite's preview: as its opener said, unless
 *  the plans list since has the reader in it (they joined meanwhile). Not
 *  from the list alone: an invite that arrived while Logjam Web was open is
 *  not in it yet, and the member's page 404s for someone invited. */
export function opensPreview(
  invited: boolean,
  listed: TripPlanMemberStatus | undefined,
): boolean {
  return invited && listed !== "active";
}

/** The first form a person answered, for a leader reading their request. */
export function answeredForm(
  plan: Pick<TripPlanView, "forms">,
  userId: string,
): string | null {
  return (
    plan.forms.find((form) =>
      form.answers.some((answer) => answer.user.id === userId),
    )?.id ?? null
  );
}

/**
 * A joiner's answers to the forms required to join, each echoing the form as
 * shown (`TripPlanJoinAnswers`), or the first sentence the shared
 * parser refuses with.
 */
export function joinAnswers(
  forms: readonly TripPlanJoinForm[],
  drafts: Record<string, TripPlanAnswerDraft>,
): { value: TripPlanJoinAnswers } | { sentence: string } {
  const value: TripPlanJoinAnswers = {};
  for (const form of forms) {
    const parsed = parseTripPlanAnswers(
      form.questions,
      answersFromDraft(form.questions, drafts[form.id] ?? {}),
    );
    if (!("value" in parsed))
      return {
        sentence:
          "sentence" in parsed
            ? parsed.sentence
            : "Answer the forms marked required to join.",
      };
    value[form.id] = {
      answers: parsed.value,
      visibleTo: form.visibleTo,
      formUpdatedAt: form.updatedAt,
    };
  }
  return { value };
}

type ChargedFile = { sizeBytes: string; chargedTo: { id: string } | null };

/** Every file in a plan that counts against someone's storage. */
function planFiles(plan: TripPlanView): ChargedFile[] {
  return [
    ...plan.files,
    ...plan.geoPdfs,
    ...plan.places.flatMap((place) => place.media),
  ];
}

/** The files a person's storage pays for: what a removal moves or deletes. */
export function filesChargedTo(plan: TripPlanView, userId: string) {
  const files = planFiles(plan).filter((file) => file.chargedTo?.id === userId);
  return {
    count: files.length,
    bytes: files.reduce((sum, file) => sum + Number(file.sizeBytes), 0),
  };
}

/** What a person added, counted as the leave dialog prices it. */
export function addedBy(plan: TripPlanView, userId: string) {
  const mine = <T extends { addedBy: { id: string } | null }>(items: T[]) =>
    items.filter((item) => item.addedBy?.id === userId);
  const places = mine(plan.places);
  const files = [
    ...mine(plan.files),
    ...mine(plan.geoPdfs),
    ...places.flatMap((place) => place.media),
  ];
  return {
    places: places.length,
    ways: mine(plan.routes).length + mine(plan.files).length,
    maps: mine(plan.geoPdfs).length,
    bytes: files.reduce((sum, file) => sum + Number(file.sizeBytes), 0),
  };
}
