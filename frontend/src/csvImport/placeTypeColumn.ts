import { PLACE_TYPE_HEADER } from "@logjam/shared";

import { normalize } from "./placeColumns";

// Matched by header like the other columns, but only under the export's one
// name for it (shared/src/placeExport.ts): a plain "Type" is as likely to be a
// field of the user's own.

// The export prefixes a `'` to a cell that starts like a formula
// (placeExport.ts `neutralizeFormula`); a type named `-Hut` leaves as `'-Hut`.
function undoFormulaGuard(cell: string): string {
  return /^'[=+\-@]/.test(cell) ? cell.slice(1) : cell;
}

/**
 * The one place type a file's `placeType` column names. `typeId` is null when
 * there is no such column, a name is empty, or the file has more than one type
 * (`several`), or the one name is no type of the user's (`unknown`, as the file
 * spells it). The caller keeps the type the user chose in those cases, so a
 * file without the column imports as before.
 */
export function placeTypeOfFile(
  headers: string[],
  rows: Record<string, string>[],
  types: { id: string; name: string }[],
): { typeId: string | null; several: boolean; unknown: string | null } {
  const none = { typeId: null, several: false, unknown: null };
  const header = headers.find(
    (h) => normalize(h) === normalize(PLACE_TYPE_HEADER),
  );
  if (!header) return none;
  const names = new Map<string, string>();
  for (const row of rows) {
    const name = undoFormulaGuard((row[header] ?? "").trim());
    if (name && !names.has(name.toLowerCase()))
      names.set(name.toLowerCase(), name);
  }
  if (names.size !== 1) return { ...none, several: names.size > 1 };
  const [[key, name]] = names;
  const typeId = types.find((t) => t.name.trim().toLowerCase() === key)?.id;
  return typeId
    ? { typeId, several: false, unknown: null }
    : { ...none, unknown: name };
}
