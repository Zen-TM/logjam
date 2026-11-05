import { describe, expect, it } from "vitest";

import {
  CANYON_GRADE_ROW_KEY,
  canyonGradeRows,
  formatCanyonGrade,
  withoutCanyonGradeRows,
} from "./canyonGrade.js";
import type { AttributeRow } from "./logbook.js";
import { makeCustomFieldKey } from "./tripLogFields.js";

// Mutations that turn this red: join the segments with a space again; let
// `withoutCanyonGradeRows` keep any of the three inputs; drop the "Grade" row
// from `canyonGradeRows` when only the commitment is set.
const values = { v_grade: 3, a_grade: 4, commitment: 3, quality: 4 };
const rows: AttributeRow[] = [
  ["v_grade", "V grade", 3, "integer"],
  ["a_grade", "A grade", 4, "integer"],
  ["commitment", "Commitment", 3, "integer"],
  ["quality", "Quality", 4, "float"],
];

describe("the canyon grade as one value", () => {
  it("writes v, a and commitment together with no space", () => {
    expect(formatCanyonGrade(values)).toBe("v3a4III");
  });

  it("shows what is set and nothing else", () => {
    expect(formatCanyonGrade({ v_grade: 2 })).toBe("v2");
    expect(formatCanyonGrade({ commitment: 2 })).toBe("II");
    expect(formatCanyonGrade({ a_grade: 1, commitment: 6 })).toBe("a1VI");
    expect(formatCanyonGrade({ quality: 4 })).toBeNull();
  });

  it("takes the three inputs out of an attribute table", () => {
    expect(withoutCanyonGradeRows(rows).map(([key]) => key)).toEqual([
      "quality",
    ]);
  });

  it("collapses them into one Grade row, first, when any is set", () => {
    expect(canyonGradeRows(rows, values)).toEqual([
      ["canyon-grade", "Grade", "v3a4III", "string"],
      ["quality", "Quality", 4, "float"],
    ]);
    expect(canyonGradeRows(rows.slice(2), { commitment: 3 })[0]).toEqual([
      "canyon-grade",
      "Grade",
      "III",
      "string",
    ]);
    expect(canyonGradeRows(rows.slice(3), { quality: 4 })).toEqual(
      rows.slice(3),
    );
  });
});

// Mutation: key the row `grade` again: a user attribute labelled "Grade" is
// stored under that key, and the page would draw two rows with one React key.
describe("the Grade row's key", () => {
  it("is not the key a user attribute labelled Grade gets", () => {
    expect(CANYON_GRADE_ROW_KEY).not.toBe(makeCustomFieldKey("Grade"));
    expect(makeCustomFieldKey(CANYON_GRADE_ROW_KEY)).not.toBe(
      CANYON_GRADE_ROW_KEY,
    );
  });
});
