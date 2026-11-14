// Canyon grade display formatting, shared so Logjam Web and Logjam GPS
// render grades identically.
//
// Canyon-specific presenter: `v3a4III` is not a generic way to show three
// numbers; it is how a canyon's grade is written, and no other place type has
// one. This is a presenter the generic field renderer defers to when a place is
// of the Canyon type, not a rule the renderer applies to everything.
//
// The keys are the system field definitions' own (`shared/src/placeTypes.ts`),
// so a renamed system field breaks this at the type level rather than silently
// rendering nothing.

import { numericFieldValue } from "./fieldValues.js";
import type { AttributeRow } from "./logbook.js";
import { fieldValueLabel } from "./placeTypes.js";

const COMMITMENT_NUMERALS = ["I", "II", "III", "IV", "V", "VI"];

/** The ACA grade as it is written, "3B III R": technical and water glued, the
 *  time and the risk each after a space. Null when none of the four is set. */
function formatAcaGrade(fieldValues: unknown): string | null {
  const label = (key: string) =>
    fieldValueLabel(key, numericFieldValue(fieldValues, key)) ?? "";
  const technicalAndWater = `${label("aca_technical")}${label("aca_water")}`;
  return (
    [technicalAndWater, label("aca_time"), label("aca_risk")]
      .filter(Boolean)
      .join(" ") || null
  );
}

/**
 * Render a canyon's grade as one value, `v3a4III` in the French system or
 * "3B III R" in the ACA one, omitting any segment that isn't set.
 *
 * The French grade wins when any French field is set: a canyon holding both
 * shows one grade, never two, and the ACA values stay stored for when the
 * French ones are cleared. Pinned by `canyonGrade.test.ts`.
 *
 * Unset segments are dropped rather than filled with a placeholder: a literal
 * `v2a?` reads as corrupt data, when it only means "no A grade recorded". The
 * three stay glued together because that's how the grade is written.
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
  return `${vaGrade}${commitmentNumeral}` || formatAcaGrade(fieldValues);
}

const GRADE_KEYS: readonly string[] = [
  "v_grade",
  "a_grade",
  "commitment",
  "aca_technical",
  "aca_water",
  "aca_time",
  "aca_risk",
];

/** One of the seven stored inputs `formatCanyonGrade` combines. */
export const isCanyonGradeKey = (key: string): boolean =>
  GRADE_KEYS.includes(key);

/**
 * A page's attribute rows without the grade inputs: they are stored and
 * edited separately but displayed as the one `formatCanyonGrade` value, which
 * the page draws itself (the hero pill, or `canyonGradeRows` where it has none).
 */
export function withoutCanyonGradeRows(rows: AttributeRow[]): AttributeRow[] {
  return rows.filter(([key]) => !isCanyonGradeKey(key));
}

/**
 * The key and label of the one Grade row. The key is not a slug of any
 * label (those use underscores), so a user attribute named "Grade", whose
 * key is `grade`, never shares it.
 */
export const CANYON_GRADE_ROW_KEY = "canyon-grade";
export const CANYON_GRADE_ROW_LABEL = "Grade";

/** The one Grade row for these field values, or null when none is set. */
export function canyonGradeRow(fieldValues: unknown): AttributeRow | null {
  const grade = formatCanyonGrade(fieldValues);
  return grade
    ? [CANYON_GRADE_ROW_KEY, CANYON_GRADE_ROW_LABEL, grade, "string"]
    : null;
}

/** The rows with the grade inputs collapsed into one "Grade" row, first. */
export function canyonGradeRows(
  rows: AttributeRow[],
  fieldValues: unknown,
): AttributeRow[] {
  const grade = canyonGradeRow(fieldValues);
  const rest = withoutCanyonGradeRows(rows);
  return grade ? [grade, ...rest] : rest;
}
