// Canyon grade display formatting, shared so Logjam Web and Logjam GPS
// render grades identically.
//
// Canyon-specific presenter: `v3a4 III` is not a generic way to show three
// numbers; it is how a canyon's grade is written, and no other place type has
// one. This is a presenter the generic field renderer defers to when a place is
// of the Canyon type, not a rule the renderer applies to everything.
//
// The keys are the system field definitions' own (`shared/src/placeTypes.ts`),
// so a renamed system field breaks this at the type level rather than silently
// rendering nothing.

import { numericFieldValue } from "./fieldValues.js";

const COMMITMENT_NUMERALS = ["I", "II", "III", "IV", "V", "VI"];

/**
 * Render a canyon's grade as `v3a4 III`, omitting any segment that isn't set.
 *
 * Unset segments are dropped rather than filled with a placeholder: a literal
 * `v2a?` reads as corrupt data, when it only means "no A grade recorded". `v`
 * and `a` stay glued together (`v2a3`) because that's how the grade is
 * written; the commitment numeral is space-separated.
 *
 * Returns null when nothing is set, so callers can drop the "Grade:" label
 * entirely instead of printing an empty one — which is also what a place of a
 * type that has no grades returns, with no special case.
 */
export function formatCanyonGrade(fieldValues: unknown): string | null {
  const vGrade = numericFieldValue(fieldValues, "v_grade");
  const aGrade = numericFieldValue(fieldValues, "a_grade");
  const commitment = numericFieldValue(fieldValues, "commitment");
  const vaGrade = `${vGrade ? `v${vGrade}` : ""}${aGrade ? `a${aGrade}` : ""}`;
  // Commitment is validated to 1-6 by its system definition's bounds, but
  // index defensively: a display formatter must never render "undefined" to
  // the user.
  const commitmentNumeral = commitment
    ? (COMMITMENT_NUMERALS[commitment - 1] ?? "")
    : "";
  const segments = [vaGrade, commitmentNumeral].filter((s) => s !== "");
  if (segments.length === 0) return null;
  return segments.join(" ");
}
