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
});
