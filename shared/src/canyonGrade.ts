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
import { t } from "./i18n.js";
import type { AttributeRow } from "./logbook.js";
import { fieldValueLabel } from "./placeTypes.js";
import {
  regionAt,
  REGIONS,
  type CanyonGradeSystem,
  type Region,
} from "./regions.js";
import { defsForType, type ScopedCustomFieldDef } from "./tripLogFields.js";

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

/** The French grade as it is written, "v3a4III", or null when none of its three is set. */
function formatFrenchGrade(fieldValues: unknown): string | null {
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
  return `${vaGrade}${commitmentNumeral}` || null;
}

/**
 * Render a canyon's grade as one value, `v3a4III` in the French system or
 * "3B III R" in the ACA one, omitting any segment that isn't set.
 *
 * The French grade wins when any French field is set: a canyon holding both
 * has one grade here, and the ACA one is its own row on the place page
 * (`acaGradeRow`). Pinned by `canyonGrade.test.ts`.
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
  return formatFrenchGrade(fieldValues) ?? formatAcaGrade(fieldValues);
}

/** The stored fields each system writes a grade in. */
const SYSTEM_KEYS: Record<CanyonGradeSystem, readonly string[]> = {
  french: ["v_grade", "a_grade", "commitment"],
  aca: ["aca_technical", "aca_water", "aca_time", "aca_risk"],
};

const GRADE_KEYS: readonly string[] = [
  ...SYSTEM_KEYS.french,
  ...SYSTEM_KEYS.aca,
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
const ACA_GRADE_ROW_KEY = "aca-grade";
const ACA_GRADE_ROW_LABEL = t`ACA grade`;

/** The one Grade row for these field values, or null when none is set. */
export function canyonGradeRow(fieldValues: unknown): AttributeRow | null {
  const grade = formatCanyonGrade(fieldValues);
  return grade
    ? [CANYON_GRADE_ROW_KEY, CANYON_GRADE_ROW_LABEL, grade, "string"]
    : null;
}

/** The rows with the grade inputs collapsed into one "Grade" row, first, and
 *  the ACA grade of a canyon that holds both systems after it. */
export function canyonGradeRows(
  rows: AttributeRow[],
  fieldValues: unknown,
): AttributeRow[] {
  const grades = [canyonGradeRow(fieldValues), acaGradeRow(fieldValues)].filter(
    (row) => row !== null,
  );
  return [...grades, ...withoutCanyonGradeRows(rows)];
}

/** The ACA grade as a row of its own, for a canyon that holds a French grade
 *  too: `formatCanyonGrade` shows the French one alone, and nothing else would
 *  show these values outside the edit form. Null otherwise: the ACA grade is
 *  already the Grade row when no French field is set. */
export function acaGradeRow(fieldValues: unknown): AttributeRow | null {
  const aca = formatAcaGrade(fieldValues);
  return aca && formatFrenchGrade(fieldValues)
    ? [ACA_GRADE_ROW_KEY, ACA_GRADE_ROW_LABEL, aca, "string"]
    : null;
}

/**
 * The system a canyon at a position is graded in: that of the region holding
 * it, French outside every region and where the position is not known yet (a
 * form before its coordinates are typed). Guard: `canyonGrade.test.ts`.
 */
export function gradeSystemAt(
  lon: number | null,
  lat: number | null,
  regions: readonly Region[] = REGIONS,
): CanyonGradeSystem {
  if (lon === null || lat === null) return "french";
  return regionAt(lon, lat, regions)?.canyonGrades ?? "french";
}

/**
 * The keys of the grade fields a Canyon form offers at a position: the
 * fields of the system used there, plus any field that already holds a value.
 * The second part is what stops a form eating data: a form saves what it
 * shows, so an ACA value on a canyon in NSW stays on screen until the user
 * clears it. A value is held when it is not absent, null or an empty string,
 * so a form's own text and stored values both work. Guard:
 * `canyonGrade.test.ts`.
 */
export function gradeFieldsAt(
  lon: number | null,
  lat: number | null,
  fieldValues: unknown,
  regions: readonly Region[] = REGIONS,
): readonly string[] {
  const used = SYSTEM_KEYS[gradeSystemAt(lon, lat, regions)];
  const values =
    typeof fieldValues === "object" && fieldValues !== null
      ? (fieldValues as Record<string, unknown>)
      : {};
  const held = (key: string) =>
    values[key] !== undefined && values[key] !== null && values[key] !== "";
  return GRADE_KEYS.filter((key) => used.includes(key) || held(key));
}

/**
 * The definitions a place's form shows: `defsForType`, with the grade fields
 * cut to `gradeFieldsAt`. The one rule both clients apply, so a canyon in
 * Utah offers the same fields on a phone and in a browser.
 */
export function placeFormDefs(
  defs: readonly ScopedCustomFieldDef[],
  placeTypeId: string,
  lon: number | null,
  lat: number | null,
  fieldValues: unknown,
  regions: readonly Region[] = REGIONS,
): ScopedCustomFieldDef[] {
  const grades = gradeFieldsAt(lon, lat, fieldValues, regions);
  return defsForType(defs, placeTypeId).filter(
    (def) => !isCanyonGradeKey(def.key) || grades.includes(def.key),
  );
}

/**
 * The stored fields a list of places is sorted by for "Easiest first": the two
 * that rank difficulty in the system used where the list is looking, then the
 * other system's two, so a canyon graded only in the other system still sorts
 * among the graded ones. Guard: `placeFilter.test.ts`.
 */
export function gradeSortKeys(system: CanyonGradeSystem): readonly string[] {
  const other: CanyonGradeSystem = system === "aca" ? "french" : "aca";
  return [
    ...SYSTEM_KEYS[system].slice(0, 2),
    ...SYSTEM_KEYS[other].slice(0, 2),
  ];
}
