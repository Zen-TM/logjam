// A form being filled in, on either client: what each control holds, and how
// that becomes the answers PUT …/answers/me and a join take. The shared
// parser (`parseTripPlanAnswers`) then trims, caps and checks what is
// required. Guard: tripPlanAnswerDraft.test.ts.
import {
  currentTripPlanAnswers,
  type TripPlanAnswers,
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
 * option went or that no longer fits its question's kind is dropped; the
 * rest, ticks included, stay.
 */
export function fitAnswerDraft(
  questions: readonly TripPlanQuestion[],
  draft: TripPlanAnswerDraft,
): TripPlanAnswerDraft {
  return draftFromAnswers(
    questions,
    currentTripPlanAnswers(questions, answersFromDraft(questions, draft)),
  );
}
