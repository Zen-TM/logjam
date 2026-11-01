// The pure decisions of Plans' pages that only Logjam Web has (the print
// summary, what a press on the map asks), out of the components so a test can
// hold them (frontend/DESIGN.md §4). The edit forms' own are in shared.
import {
  currentTripPlanAnswers,
  TRIP_PLAN_FORM_PRESETS,
  TRIP_PLAN_PRINTED_COLUMNS,
  TRIP_PLAN_PRINTED_PRESETS,
  tripPlanAnswerText,
  tripPlanRoleWord,
} from "@logjam/shared";
import type {
  TripPlanFormPresetId,
  TripPlanFormView,
  TripPlanItemKind,
  TripPlanView,
} from "@logjam/shared";

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

/** What a person added, counted as the leave dialog prices it. */
export function addedBy(plan: TripPlanView, userId: string) {
  const mine = <T extends { addedBy: { id: string } | null }>(items: T[]) =>
    items.filter((item) => item.addedBy?.id === userId);
  const places = mine(plan.places);
  const files = [
    ...mine(plan.files),
    ...places.flatMap((place) => place.media),
  ];
  return {
    places: places.length,
    ways: mine(plan.routes).length + mine(plan.files).length,
    bytes: files.reduce((sum, file) => sum + Number(file.sizeBytes), 0),
  };
}

/**
 * What a press on the map asks while a plan is open: Add a place or way of one of
 * the user's own things, or nothing (the plan's own, or someone else's). A
 * file of theirs asks for itself, even on a place: its place brings it only
 * with its photos. Any other track on their place asks for the place.
 */
export function planMapPress(
  press: { kind: "place" | "route" | "track"; id: string },
  own: {
    places: readonly { id: string }[];
    routes: readonly { id: string; ownerId: string }[];
    files: readonly { id: string; linkedPlaceId: string | null }[];
    tracks: readonly { mediaId: string; placeId: string }[];
  },
  me: string | null,
): { kind: TripPlanItemKind; id: string } | null {
  const mine = (placeId: string | null | undefined) =>
    placeId != null && own.places.some((place) => place.id === placeId)
      ? { kind: "place" as const, id: placeId }
      : null;
  switch (press.kind) {
    case "place":
      return mine(press.id);
    case "route":
      return own.routes.some(
        (route) => route.id === press.id && route.ownerId === me,
      )
        ? { kind: "route", id: press.id }
        : null;
    case "track": {
      if (own.files.some((file) => file.id === press.id))
        return { kind: "media", id: press.id };
      return mine(
        own.tracks.find((each) => each.mediaId === press.id)?.placeId,
      );
    }
  }
}
