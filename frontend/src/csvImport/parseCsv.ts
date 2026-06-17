import Papa from "papaparse";

export type ParsedCsv = {
  headers: string[];
  rows: Record<string, string>[];
};

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
        resolve({ headers, rows });
      },
      error: (err) => reject(new Error(err.message)),
    });
  });
}
