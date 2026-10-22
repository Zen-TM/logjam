// A form being filled in, on either client: what each control holds, and how
// that becomes the answers PUT …/answers/me and a join take. The shared
// parser (`parseTripPlanAnswers`) then trims, caps and checks what is
// required. Guard: tripPlanAnswerDraft.test.ts.
import {
  currentTripPlanAnswers,
  parseTripPlanAnswers,
  type TripPlanAnswers,
  type TripPlanJoinAnswers,
  type TripPlanJoinForm,
  type TripPlanQuestion,
} from "./tripPlans.js";

/** What each control holds: a number is the text in its field, a yes or no
 *  the chip's "true" or "false", an agree box a boolean, a tick list the
 *  ticked option ids. */
export type TripPlanAnswerDraft = Record<string, string | string[] | boolean>;

export function draftFromAnswers(
  questions: readonly TripPlanQuestion[],
  answers: TripPlanAnswers,
): TripPlanAnswerDraft {
  const draft: TripPlanAnswerDraft = {};
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

/**
 * The draft as the wire takes it; an empty control says nothing. A value is
 * converted only when it is what its kind holds ("true"/"false" for a yes or
 * no, digits for a number); anything else goes as it is, for the parser to
 * refuse, never turned into an answer nobody gave.
 */
export function answersFromDraft(
  questions: readonly TripPlanQuestion[],
  draft: TripPlanAnswerDraft,
): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const question of questions) {
    const value = draft[question.id];
    if (value === undefined || value === "" || value === false) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    answers[question.id] =
      question.kind === "number" &&
      typeof value === "string" &&
      value.trim() !== "" &&
      Number.isFinite(Number(value))
        ? Number(value)
        : question.kind === "yesNo" && (value === "true" || value === "false")
          ? value === "true"
          : value;
  }
  return answers;
}

/**
 * A draft fitted to the form as it now is, after it changed under the person
 * (a 409, then the form fetched again): an answer whose question went, whose
 * option went or whose question changed kind since `was` (the questions the
 * draft was made for) is dropped; the rest, ticks included, stay. A kind is
 * compared, not guessed from the value: a yes or no's "false" and a choice's
 * option id are both text a text question would take.
 */
export function fitAnswerDraft(
  was: readonly TripPlanQuestion[],
  questions: readonly TripPlanQuestion[],
  draft: TripPlanAnswerDraft,
): TripPlanAnswerDraft {
  const kindWas = new Map(was.map((question) => [question.id, question.kind]));
  const kept = Object.fromEntries(
    Object.entries(draft).filter(([id]) =>
      questions.some(
        (question) => question.id === id && question.kind === kindWas.get(id),
      ),
    ),
  );
  return draftFromAnswers(
    questions,
    currentTripPlanAnswers(questions, answersFromDraft(questions, kept)),
  );
}

/**
 * A joiner's answers to the forms required to join, each echoing the form as
 * shown (`TripPlanJoinAnswers`), or the first sentence the shared parser
 * refuses with. Both clients' Join sends this.
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
