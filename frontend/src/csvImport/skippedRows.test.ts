import { describe, expect, it } from "vitest";

import { parseCsv } from "./parseCsv";
import { skippedRowsNote, splitSkippedRows } from "./prepareRows";

// Mutation that turns these red: change SKIPPED_ROW_SUFFIX in prepareRows.ts
// without the lines preparePlaceRows and prepareTripRows push.
describe("dropped rows", () => {
  const warnings = [
    'Row 4: latitude "x" couldn\'t be read — skipped',
    'Row 5: "n/a" in the depth column was left empty',
  ];

  it("separates dropped rows from fields left empty", () => {
    expect(splitSkippedRows(warnings)).toEqual({
      skipped: [],
      leftEmpty: warnings,
    });
  });

  it("says which rows the confirm step will skip", () => {
    expect(
      skippedRowsNote([
        { rowIndex: 0, reason: "latitude 'x' couldn't be read" },
      ]),
    ).toBe("1 row can't be read and will be skipped (row 2).");
    expect(
      skippedRowsNote([
        { rowIndex: 0, reason: "latitude 'x' couldn't be read" },
        { rowIndex: 5, reason: "date" },
      ]),
    ).toBe("2 rows can't be read and will be skipped (rows 2, 7).");
    expect(skippedRowsNote([])).toBe("");
  });
});

// Mutation: number rows `at + 2` in parseCsv again, or stop counting title and
// blank lines.
describe("parseCsv's line numbers", () => {
  const file = (text: string) =>
    new File([text], "a.csv", { type: "text/csv" });

  it("counts title lines, blank lines and a quoted cell's own breaks", async () => {
    const parsed = await parseCsv(
      file(
        'My canyons\nname,latitude,longitude\n\nA,-33,150\n\n\n"B\nB",-34,151\nC,-35,152\n',
      ),
    );
    expect(parsed.rows.map((r) => r.name)).toEqual(["A", "B\nB", "C"]);
    expect(parsed.lines).toEqual([4, 7, 9]);
  });

  it("does not read a line of only commas as a row", async () => {
    const parsed = await parseCsv(
      file("name,latitude,longitude\nA,-33,150\n,,\nB,-34,151\n"),
    );
    expect(parsed.rows.map((r) => r.name)).toEqual(["A", "B"]);
    expect(parsed.lines).toEqual([2, 4]);
  });
});
