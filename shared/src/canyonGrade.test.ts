import { describe, expect, it } from "vitest";

import {
  CANYON_GRADE_ROW_KEY,
  isCanyonGradeKey,
  canyonGradeRows,
  formatCanyonGrade,
  withoutCanyonGradeRows,
} from "./canyonGrade.js";
import type { AttributeRow } from "./logbook.js";
import { SYSTEM_FIELD_DEFS } from "./placeTypes.js";
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

// Mutations that turn this red: drop an ACA key from `GRADE_KEYS` (its value
// would draw as a row of its own beside the Grade row); let the ACA grade win
// over a French one; join the ACA segments with no space.
describe("the ACA grade", () => {
  const aca = { aca_technical: 3, aca_water: 2, aca_time: 3, aca_risk: 3 };

  it("writes technical and water together, then time, then risk", () => {
    expect(formatCanyonGrade(aca)).toBe("3B III R");
  });

  it("reads each rank as its label", () => {
    expect(formatCanyonGrade({ aca_technical: 4, aca_water: 7 })).toBe("4C4");
    expect(formatCanyonGrade({ aca_water: 4, aca_risk: 5 })).toBe("C1 XX");
    expect(formatCanyonGrade({ aca_risk: 1 })).toBe("PG");
    expect(formatCanyonGrade({ aca_risk: 2 })).toBe("PG13");
  });

  it("shows what is set and nothing else", () => {
    expect(formatCanyonGrade({ aca_time: 6 })).toBe("VI");
    expect(formatCanyonGrade({ aca_risk: 4, quality: 4 })).toBe("X");
  });

  it("shows the French grade alone when both systems are set", () => {
    expect(formatCanyonGrade({ ...aca, v_grade: 3 })).toBe("v3");
    expect(formatCanyonGrade({ ...aca, commitment: 2 })).toBe("II");
  });

  it("skips a value outside its labels", () => {
    expect(formatCanyonGrade({ aca_water: 8, aca_risk: 6 })).toBeNull();
  });

  it("collapses the four inputs into the one Grade row", () => {
    const acaRows: AttributeRow[] = [
      ["aca_technical", "ACA technical", 3, "integer"],
      ["aca_water", "ACA water", 2, "integer"],
      ["aca_time", "ACA time", 3, "integer"],
      ["aca_risk", "ACA risk", 3, "integer"],
      ["quality", "Quality", 4, "float"],
    ];
    expect(canyonGradeRows(acaRows, aca)).toEqual([
      ["canyon-grade", "Grade", "3B III R", "string"],
      ["quality", "Quality", 4, "float"],
    ]);
  });

  it("is covered by isCanyonGradeKey for every ACA definition", () => {
    const keys = SYSTEM_FIELD_DEFS.map((def) => def.key).filter((key) =>
      key.startsWith("aca_"),
    );
    // A floor: a renamed prefix must not leave this checking nothing.
    expect(keys).toHaveLength(4);
    for (const key of keys) expect(isCanyonGradeKey(key), key).toBe(true);
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
