import Papa from "papaparse";
import { splitCombinedCoordinates } from "./combinedCoordinates";

export type ParsedCsv = {
  headers: string[];
  rows: Record<string, string>[];
  // The line of the file each row starts on (blank lines, title lines and a
  // quoted cell's own line breaks all count), for "Row 4" to be the line the
  // user sees in a spreadsheet or editor.
  lines: number[];
  // Non-fatal problems found while parsing (PapaParse row errors — unbalanced
  // quotes, too-many-fields rows — plus a note for any header PapaParse had to
  // rename because it collided with an earlier one). Parsing still returns
  // whatever it could read; the caller decides how to warn the user.
  // Empty when the file parsed cleanly.
  parseErrors: string[];
};

// PapaParse (5.5+) auto-renames a duplicate header ("lat" → "lat_1") rather
// than letting the second column's values silently overwrite the first's —
// so no data is lost, but the rename is invisible unless surfaced: without
// this, a user staring at the column-mapping step sees an unexplained
// "lat_1" and no clue two of their columns shared a name.
function renamedHeaderNotices(
  renamedHeaders: Record<string, string> | undefined,
): string[] {
  if (!renamedHeaders) return [];
  return Object.entries(renamedHeaders).map(
    ([renamed, original]) =>
      `Column "${original}" appeared more than once — the extra one was renamed "${renamed}"`,
  );
}

// A title line above the header ("My canyons - 2024", or Excel's "Title,,,")
// would become the header. Skip leading lines with at most one filled cell
// while a later line has more, looking at the first few lines only.
const MAX_TITLE_LINES = 5;
function dropTitleLines(chunk: string): { text: string; dropped: number } {
  const lines = chunk
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/, MAX_TITLE_LINES + 1);
  const filled = lines.map(
    (l) =>
      (Papa.parse<string[]>(l).data[0] ?? []).filter((c) => c.trim()).length,
  );
  const header = filled.findIndex((n) => n > 1);
  if (header < 1) return { text: chunk, dropped: 0 };
  return {
    text: chunk
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .slice(header)
      .join("\n"),
    dropped: header,
  };
}

/** The line each non-empty row of `text` starts on: Papa's cursor is the end
 *  of the row just read, so a row starts at the previous cursor past any blank
 *  lines. The header row is first. */
function rowStartLines(text: string): number[] {
  const lines: number[] = [];
  let from = 0;
  Papa.parse<string[]>(text, {
    skipEmptyLines: true,
    step: (result) => {
      let start = from;
      while (text[start] === "\n" || text[start] === "\r") start += 1;
      lines.push(1 + (text.slice(0, start).match(/\n/g)?.length ?? 0));
      from = result.meta.cursor;
    },
  });
  return lines;
}

export function parseCsv(file: File): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    let text = "";
    let droppedTitleLines = 0;
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      // One chunk, so the text the line numbers are read from is the whole file
      // (the importer caps a file well under this).
      chunkSize: 64 * 1024 * 1024,
      beforeFirstChunk: (chunk) => {
        const kept = dropTitleLines(chunk);
        text = kept.text;
        droppedTitleLines = kept.dropped;
        return kept.text;
      },
      // Trim headers at parse time so the row objects papaparse builds are keyed
      // by the SAME trimmed names we expose in `headers`. Without this, a CSV
      // whose header cells carry surrounding whitespace (" Name ,Date") keys the
      // rows by the raw header while the lookup below uses the trimmed one — and
      // every value silently comes back empty.
      transformHeader: (h) => h.trim(),
      complete: (result) => {
        const headers = (result.meta.fields ?? []).map((h) => h.trim());
        // A line of only commas ("Excel's ,,,") is no row, so it is neither
        // read nor reported as one it can't read.
        const starts = rowStartLines(text).slice(1);
        const lines: number[] = [];
        const rows = result.data.flatMap((row, at) => {
          const trimmed: Record<string, string> = {};
          for (const h of headers) {
            trimmed[h] = (row[h] ?? "").trim();
          }
          if (headers.every((h) => trimmed[h] === "")) return [];
          lines.push((starts[at] ?? at + 2) + droppedTitleLines);
          return [trimmed];
        });
        // A malformed row misaligns every field after it with no signal to
        // the user.
        const parseErrors = [
          ...result.errors.map((e) =>
            e.row != null ? `Row ${e.row + 2}: ${e.message}` : e.message,
          ),
          ...renamedHeaderNotices(result.meta.renamedHeaders),
        ];
        resolve({
          ...splitCombinedCoordinates(headers, rows),
          lines,
          parseErrors,
        });
      },
      error: (err) => reject(new Error(err.message)),
    });
  });
}
