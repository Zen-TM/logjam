import type { TripLogCustomFieldDef } from "@logjam/shared";

export type ColumnRole =
  | "name"
  | "date"
  | "notes"
  | `cf:${string}`
  | "new-cf"
  | "appendNotes"
  | "discard";

const NAME_ALIASES = new Set(["name", "canyon", "canyon name", "location", "place", "site"]);
const DATE_ALIASES = new Set(["date", "trip date", "trip date", "visited", "when", "visit date", "trip"]);
const NOTES_ALIASES = new Set(["notes", "comments", "comment", "description", "note", "details", "remarks"]);

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, " ").trim();
}

export function detectColumns(
  headers: string[],
  customFieldDefs: TripLogCustomFieldDef[],
): Record<string, ColumnRole> {
  const result: Record<string, ColumnRole> = {};
  for (const header of headers) {
    const n = normalize(header);
    if (NAME_ALIASES.has(n)) {
      result[header] = "name";
    } else if (DATE_ALIASES.has(n)) {
      result[header] = "date";
    } else if (NOTES_ALIASES.has(n)) {
      result[header] = "notes";
    } else {
      const matchDef = customFieldDefs.find(
        (d) => normalize(d.label) === n || d.key === n.replace(/ /g, "_"),
      );
      if (matchDef) {
        result[header] = `cf:${matchDef.key}`;
      } else {
        result[header] = "discard";
      }
    }
  }
  return result;
}
