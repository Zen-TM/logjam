import { describe, expect, it } from "vitest";

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
      skipped: [warnings[0]],
      leftEmpty: [warnings[1]],
    });
  });

  it("says which rows the confirm step will skip", () => {
    expect(skippedRowsNote([warnings[0]])).toBe(
      "1 row can't be read and will be skipped (row 4).",
    );
    expect(skippedRowsNote([warnings[0], "Row 9: date — skipped"])).toBe(
      "2 rows can't be read and will be skipped (rows 4, 9).",
    );
    expect(skippedRowsNote([])).toBe("");
  });
});
