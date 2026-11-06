import { normalize } from "./placeColumns";

// The CSV export's column naming a place's type, which the import reads back so
// a file lands in the type it came from. Matched by header like the other
// columns, but only under this one name: a plain "Type" is as likely to be a
// field of the user's own.
export const PLACE_TYPE_HEADER = "placeType";

/**
 * The one place type a file's `placeType` column names, else null: no such
 * column, an empty or unknown name, or more than one type (`several`). The
 * caller keeps the type the user chose in those cases, so a file without the
 * column imports as before.
 */
export function placeTypeOfFile(
  headers: string[],
  rows: Record<string, string>[],
  types: { id: string; name: string }[],
): { typeId: string | null; several: boolean } {
  const header = headers.find(
    (h) => normalize(h) === normalize(PLACE_TYPE_HEADER),
  );
  if (!header) return { typeId: null, several: false };
  const found = new Set(
    rows.map((row) => (row[header] ?? "").trim().toLowerCase()).filter(Boolean),
  );
  if (found.size !== 1) return { typeId: null, several: found.size > 1 };
  const [name] = found;
  const typeId =
    types.find((t) => t.name.trim().toLowerCase() === name)?.id ?? null;
  return { typeId, several: false };
}
