// Canyon grade display formatting — moved from frontend/src/canyonUtils.ts so
// web and mobile render grades identically. Takes only the grade fields, so
// any canyon-shaped object satisfies it structurally.

const COMMITMENT_NUMERALS = ["I", "II", "III", "IV", "V", "VI"];

export type CanyonGradeFields = {
  vGrade: number | null;
  aGrade: number | null;
  commitment: number | null;
};

/**
 * Render a canyon's grade as `v3a4 III`, omitting any segment that isn't set.
 *
 * Unset segments are dropped rather than filled with a placeholder: a literal
 * `v2a?` reads as corrupt data, when it only means "no A grade recorded"
 * (UX fix 4). `v` and `a` stay glued together (`v2a3`) because that's how the
 * grade is written; the commitment numeral is space-separated.
 *
 * Returns null when nothing is set, so callers can drop the "Grade:" label
 * entirely instead of printing an empty one.
 */
export function formatCanyonGrade(canyon: CanyonGradeFields): string | null {
  const { vGrade, aGrade, commitment } = canyon;
  const vaGrade = `${vGrade ? `v${vGrade}` : ""}${aGrade ? `a${aGrade}` : ""}`;
  // Commitment is validated to 1-6 (shared/src/canyonValidation.ts), but index
  // defensively: a display formatter must never render "undefined" to the user.
  const commitmentNumeral = commitment
    ? (COMMITMENT_NUMERALS[commitment - 1] ?? "")
    : "";
  const segments = [vaGrade, commitmentNumeral].filter((s) => s !== "");
  if (segments.length === 0) return null;
  return segments.join(" ");
}
