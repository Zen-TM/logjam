// A coordinate field of the place form: the text it shows, the number it
// holds, and what leaving it says. Pure, so `coordinateText.test.ts` can hold
// the promises the sheet makes about a stored position.

/** "" and an unparseable entry both mean "not recorded", not zero. */
export function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** A stored position as the place's page shows it: five places, under two metres. */
const SHOWN_COORD_DECIMALS = 5;
export function shownCoord(value: number | null | undefined): string {
  return value == null
    ? ""
    : String(Number(value.toFixed(SHOWN_COORD_DECIMALS)));
}

/**
 * A picked coordinate at 6 decimal places: about 10 cm, finer than any map
 * press or GPS fix, and readable. Only a NEW point gets this; an existing
 * place shows `shownCoord`.
 */
const SEED_COORD_DECIMALS = 6;
export function seedCoord(value: number | null | undefined): string {
  return value == null
    ? ""
    : String(Number(value.toFixed(SEED_COORD_DECIMALS)));
}

/**
 * What the field shows. A place's field nobody has typed in follows the stored
 * value, so a sync that moves the place while the sheet is open is not hidden
 * behind stale text.
 */
export function coordinateText(
  typed: string,
  edited: boolean,
  stored: number | null | undefined,
): string {
  return edited || stored == null ? typed : shownCoord(stored);
}

/**
 * The number the field holds. An unedited field of a place is the stored value
 * itself, never its five-place text: opening a place and saving must not round
 * its position, nor write over what a sync brought in. Only an edited field
 * writes.
 */
export function coordinateValue(
  typed: string,
  edited: boolean,
  stored: number | null | undefined,
): number | null {
  return !edited && stored != null ? stored : parseNumber(typed);
}

/** What Save says under a coordinate field, or null. Required on an edit too. */
export function coordinateProblem(
  shown: string,
  value: number | null,
  isValid: (value: unknown) => boolean,
  missing: string,
  invalid: string,
): string | null {
  if (shown.trim() === "") return missing;
  return isValid(value) ? null : invalid;
}

/**
 * Leaving an edited field: a number is written back as a number ("-33.6290 "
 * becomes "-33.629") and a bad one is flagged now. An empty field is flagged
 * only on Save, so tapping "Select on map" never flashes an error.
 */
export function coordinateBlur(
  text: string,
  isValid: (value: unknown) => boolean,
  invalid: string,
): { text: string; error: string | null } | null {
  if (text.trim() === "") return null;
  const value = parseNumber(text);
  if (value == null) return { text, error: invalid };
  return { text: String(value), error: isValid(value) ? null : invalid };
}
