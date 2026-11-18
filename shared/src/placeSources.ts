// A place's source links, as a form edits them: Logjam Web's `PlaceDialog` and
// Logjam GPS's `PlaceEditSheet` both read the stored pairs into rows with
// `sourceRows` and turn the rows back into pairs with `cleanSources`, so the two
// accept and refuse the same input (`placeSources.test.ts`).
import { PLACE_FORM } from "./contracts/placeForm.js";
import { fieldValue } from "./fieldValues.js";
import { SOURCES_FIELD_KEY } from "./placeTypes.js";

export type SourceRow = { label: string; url: string };
/** The stored shape: `[label, url]`. */
export type SourcePair = [string, string];

/**
 * Only http(s) URLs are safe to render as a link or store as a source: any other
 * scheme (`javascript:`, `data:`, `vbscript:`) is an injection sink. The one
 * gate for the save-time refusal and for the render-time `linkable` check.
 */
export function isHttpUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** The rows a form starts from; an entry that is not a pair of strings is skipped. */
export function sourceRows(fieldValues: unknown): SourceRow[] {
  const stored = fieldValue(fieldValues, SOURCES_FIELD_KEY);
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((pair): SourceRow[] =>
    Array.isArray(pair) &&
    typeof pair[0] === "string" &&
    typeof pair[1] === "string"
      ? [{ label: pair[0], url: pair[1] }]
      : [],
  );
}

/**
 * The form's rows as the value to store under `_sources`, or the sentence for
 * the link that refuses the save and the row it is on. A link that is not
 * http(s) refuses the whole save, labelled row or not; of the rest, a row with
 * no label is dropped and a link left empty is kept. The list is `null` when
 * nothing is left, which removes the key.
 */
export function cleanSources(
  rows: readonly SourceRow[],
): { sources: SourcePair[] | null } | { error: string; index: number } {
  const index = rows.findIndex(
    (row) => row.url.trim() && !isHttpUrl(row.url.trim()),
  );
  if (index >= 0) return { error: PLACE_FORM.copy.sourceLinkInvalid, index };
  const sources = rows
    .filter((row) => row.label.trim())
    .map((row): SourcePair => [row.label.trim(), row.url.trim()]);
  return { sources: sources.length > 0 ? sources : null };
}

/**
 * What a save does about `_sources`: nothing unless the user changed the rows.
 * Stored sources can hold what the form would refuse or drop (a CSV import
 * keeps a scheme-less link and an unlabelled entry as they came), and an edit
 * to the name must not be refused for them or rewrite them.
 */
export function sourcesPatch(
  rows: readonly SourceRow[],
  fieldValues: unknown,
):
  | { patch: Record<string, SourcePair[] | null> }
  | { error: string; index: number } {
  const seeded = sourceRows(fieldValues);
  if (
    rows.length === seeded.length &&
    rows.every(
      (row, at) => row.label === seeded[at].label && row.url === seeded[at].url,
    )
  )
    return { patch: {} };
  const cleaned = cleanSources(rows);
  return "error" in cleaned
    ? cleaned
    : { patch: { [SOURCES_FIELD_KEY]: cleaned.sources } };
}

/** A source row's delete button, named by its label, else its place in the list. */
export const deleteSourceLabel = (row: SourceRow, index: number) =>
  `${PLACE_FORM.copy.deleteSource} ${row.label || index + 1}`;
