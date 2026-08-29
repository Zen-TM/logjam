import { describe, it, expect } from "vitest";
import { parseCsv } from "./parseCsv";

// parseCsv wraps papaparse with header mode, empty-line skipping, and trimming
// of both headers and every cell. jsdom (the frontend test env) provides File +
// FileReader, so papaparse's File path runs end-to-end here.

function csvFile(content: string): File {
  return new File([content], "import.csv", { type: "text/csv" });
}

describe("parseCsv", () => {
  it("trims headers and cells and returns row objects keyed by trimmed header", async () => {
    const { headers, rows } = await parseCsv(
      csvFile("  Name ,Date\n  Claustral  , 2024-01-02 "),
    );
    expect(headers).toEqual(["Name", "Date"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ Name: "Claustral", Date: "2024-01-02" });
  });

  it("skips empty lines", async () => {
    const { rows } = await parseCsv(csvFile("name\nA\n\n\nB\n"));
    expect(rows.map((r) => r.name)).toEqual(["A", "B"]);
  });

  it("fills missing trailing cells with empty strings rather than undefined", async () => {
    const { rows } = await parseCsv(csvFile("name,notes\nOnly name"));
    expect(rows[0]).toEqual({ name: "Only name", notes: "" });
  });

  // FECO-002: PapaParse's own result.errors (unbalanced quotes, too-many-fields
  // rows) used to be silently dropped — the caller had no way to know a row's
  // fields had misaligned.
  it("surfaces PapaParse row errors instead of discarding them (FECO-002)", async () => {
    // Row 2 has an extra field ("B" has 3 commas where the header has 2).
    const { parseErrors } = await parseCsv(csvFile("name,notes\nA,fine\nB,too,many,fields"));
    expect(parseErrors.length).toBeGreaterThan(0);
    expect(parseErrors.some((e) => e.includes("Row 3"))).toBe(true);
  });

  it("returns no parseErrors for a clean file", async () => {
    const { parseErrors } = await parseCsv(csvFile("name,notes\nA,fine"));
    expect(parseErrors).toEqual([]);
  });

  // FECO-002: PapaParse (5.5+) auto-renames a duplicate header rather than
  // letting the second column overwrite the first's values — both columns'
  // data survives under distinct keys — but the rename is invisible unless
  // surfaced, so a user mapping columns sees an unexplained "lat_1" with no
  // clue why.
  it("keeps both columns' data under distinct keys and flags the rename", async () => {
    const { headers, rows, parseErrors } = await parseCsv(
      csvFile("name,lat,lat\nClaustral,10,20"),
    );
    expect(headers).toEqual(["name", "lat", "lat_1"]);
    expect(rows[0]).toEqual({ name: "Claustral", lat: "10", lat_1: "20" });
    expect(parseErrors.some((e) => e.includes('"lat"') && e.includes('"lat_1"'))).toBe(true);
  });
});
