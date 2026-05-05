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
