import Papa from "papaparse";

export type ParsedCsv = {
  headers: string[];
  rows: Record<string, string>[];
  // Non-fatal problems found while parsing (PapaParse row errors — unbalanced
  // quotes, too-many-fields rows — plus a note for any header PapaParse had to
  // rename because it collided with an earlier one). Parsing still returns
  // whatever it could read; the caller decides how to warn the user
  // (FECO-002). Empty when the file parsed cleanly.
  parseErrors: string[];
};

// PapaParse (5.5+) auto-renames a duplicate header ("lat" → "lat_1") rather
// than letting the second column's values silently overwrite the first's —
// so no data is lost, but the rename is invisible unless surfaced: without
// this, a user staring at the column-mapping step sees an unexplained
// "lat_1" and no clue two of their columns shared a name.
function renamedHeaderNotices(renamedHeaders: Record<string, string> | undefined): string[] {
  if (!renamedHeaders) return [];
  return Object.entries(renamedHeaders).map(
    ([renamed, original]) =>
      `Column "${original}" appeared more than once — the extra one was renamed "${renamed}"`,
  );
}

export function parseCsv(file: File): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      // Trim headers at parse time so the row objects papaparse builds are keyed
      // by the SAME trimmed names we expose in `headers`. Without this, a CSV
      // whose header cells carry surrounding whitespace (" Name ,Date") keys the
      // rows by the raw header while the lookup below uses the trimmed one — and
      // every value silently comes back empty.
      transformHeader: (h) => h.trim(),
      complete: (result) => {
        const headers = (result.meta.fields ?? []).map((h) => h.trim());
        const rows = result.data.map((row) => {
          const trimmed: Record<string, string> = {};
          for (const h of headers) {
            trimmed[h] = (row[h] ?? "").trim();
          }
          return trimmed;
        });
        // PapaParse row errors (unbalanced quotes, wrong field count, …) used
        // to be silently dropped here — a malformed row misaligns every field
        // after it with no signal to the user (FECO-002).
        const parseErrors = [
          ...result.errors.map((e) =>
            e.row != null ? `Row ${e.row + 2}: ${e.message}` : e.message,
          ),
          ...renamedHeaderNotices(result.meta.renamedHeaders),
        ];
        resolve({ headers, rows, parseErrors });
      },
      error: (err) => reject(new Error(err.message)),
    });
  });
}
