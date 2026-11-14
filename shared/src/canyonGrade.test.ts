import { describe, expect, it } from "vitest";

import {
  acaGradeRow,
  CANYON_GRADE_ROW_KEY,
  gradeFieldsAt,
  gradeSortKeys,
  gradeSystemAt,
  isCanyonGradeKey,
  canyonGradeRows,
  formatCanyonGrade,
  placeFormDefs,
  withoutCanyonGradeRows,
} from "./canyonGrade.js";
import type { AttributeRow } from "./logbook.js";
import { SYSTEM_FIELD_DEFS } from "./placeTypes.js";
import { NSW_REGION } from "./regions.js";
import { SIM_REGIONS } from "./simRegions.js";
import {
  makeCustomFieldKey,
  type ScopedCustomFieldDef,
} from "./tripLogFields.js";

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

  // Mutation: drop the `.filter(Boolean)` in `formatAcaGrade`, so an unset
  // segment leaves its space behind.
  it("shows what is set and nothing else", () => {
    expect(formatCanyonGrade({ aca_time: 6 })).toBe("VI");
    expect(formatCanyonGrade({ aca_risk: 4, quality: 4 })).toBe("X");
  });

  it("shows the French grade alone when both systems are set", () => {
    expect(formatCanyonGrade({ ...aca, v_grade: 3 })).toBe("v3");
    expect(formatCanyonGrade({ ...aca, commitment: 2 })).toBe("II");
  });

  // Mutation: print the number for a value `fieldValueLabel` has no label for.
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

// Where a canyon is decides which system's fields its form offers. Utah is the
// simulated region that grades in ACA; the rest of the world, and a form with
// no position yet, is French.
const REGIONS_WITH_UTAH = [NSW_REGION, ...SIM_REGIONS];
const BLUE_MOUNTAINS = [150.31, -33.7] as const;
const UTAH = [-110.8, 38.27] as const;
const MID_PACIFIC = [-150, 0] as const;
const FRENCH_KEYS = ["v_grade", "a_grade", "commitment"];
const ACA_KEYS = ["aca_technical", "aca_water", "aca_time", "aca_risk"];
const at = (place: readonly [number, number]) => [place[0], place[1]] as const;

describe("the grade system at a position", () => {
  // Mutation: read `canyonGrades` of the first region instead of the one
  // holding the position.
  it("is the system of the region holding it", () => {
    expect(gradeSystemAt(...at(BLUE_MOUNTAINS), REGIONS_WITH_UTAH)).toBe(
      "french",
    );
    expect(gradeSystemAt(...at(UTAH), REGIONS_WITH_UTAH)).toBe("aca");
  });

  // Mutation: return the world's setting as `aca`, or throw on null.
  it("is French outside every region and with no position", () => {
    expect(gradeSystemAt(...at(MID_PACIFIC), REGIONS_WITH_UTAH)).toBe("french");
    expect(gradeSystemAt(null, null, REGIONS_WITH_UTAH)).toBe("french");
    expect(gradeSystemAt(UTAH[0], null, REGIONS_WITH_UTAH)).toBe("french");
  });
});

describe("the grade fields a form offers", () => {
  // Mutation: return every grade key whatever the system.
  it("is the system's own at a position", () => {
    expect(gradeFieldsAt(...at(BLUE_MOUNTAINS), {}, REGIONS_WITH_UTAH)).toEqual(
      FRENCH_KEYS,
    );
    expect(gradeFieldsAt(...at(UTAH), {}, REGIONS_WITH_UTAH)).toEqual(ACA_KEYS);
  });

  // Mutation: drop the `held` clause: a canyon in NSW with an ACA value
  // loses the field on its next save.
  it("keeps a field that already holds a value, whatever the system", () => {
    expect(
      gradeFieldsAt(
        ...at(BLUE_MOUNTAINS),
        { aca_water: 3, quality: 4 },
        REGIONS_WITH_UTAH,
      ),
    ).toEqual([...FRENCH_KEYS, "aca_water"]);
    expect(
      gradeFieldsAt(...at(UTAH), { v_grade: "2" }, REGIONS_WITH_UTAH),
    ).toEqual(["v_grade", ...ACA_KEYS]);
  });

  // Mutation: count "" as held, and a form's cleared field keeps drawing.
  it("does not count an empty text, a null or an absent value as held", () => {
    expect(
      gradeFieldsAt(
        ...at(BLUE_MOUNTAINS),
        { aca_water: "", aca_risk: null },
        REGIONS_WITH_UTAH,
      ),
    ).toEqual(FRENCH_KEYS);
    expect(gradeFieldsAt(...at(UTAH), "not values", REGIONS_WITH_UTAH)).toEqual(
      ACA_KEYS,
    );
  });
});

describe("the definitions a place form shows", () => {
  const def = (key: string, extra: Partial<ScopedCustomFieldDef> = {}) =>
    ({
      key,
      label: key,
      type: "integer",
      appliesToAllTypes: false,
      placeTypeIds: ["canyon"],
      ...extra,
    }) as unknown as ScopedCustomFieldDef;
  const defs = [
    ...[...FRENCH_KEYS, ...ACA_KEYS].map((key) => def(key)),
    def("quality"),
    def("capacity", { placeTypeIds: ["campsite"] }),
    def("permit", { appliesToAllTypes: true, placeTypeIds: [] }),
  ];
  const keys = (shown: ScopedCustomFieldDef[]) => shown.map((d) => d.key);

  // Mutation: return `defsForType` unfiltered.
  it("cuts the grade fields to the system used there and keeps the rest", () => {
    expect(
      keys(
        placeFormDefs(
          defs,
          "canyon",
          ...at(BLUE_MOUNTAINS),
          {},
          REGIONS_WITH_UTAH,
        ),
      ),
    ).toEqual([...FRENCH_KEYS, "quality", "permit"]);
    expect(
      keys(placeFormDefs(defs, "canyon", ...at(UTAH), {}, REGIONS_WITH_UTAH)),
    ).toEqual([...ACA_KEYS, "quality", "permit"]);
  });

  // Mutation: filter `defs` itself in `placeFormDefs`, not `defsForType`'s
  // answer.
  it("still follows the place type, and never hides a field that is not a grade", () => {
    expect(
      keys(placeFormDefs(defs, "campsite", ...at(UTAH), {}, REGIONS_WITH_UTAH)),
    ).toEqual(["capacity", "permit"]);
  });
});

describe("the ACA grade beside a French one", () => {
  const both = { v_grade: 3, aca_technical: 3, aca_water: 2 };

  // Mutation: return the row when no French field is set: the ACA grade
  // would show twice, as the Grade row and again here.
  it("is a row of its own only when the French grade is the Grade row", () => {
    expect(acaGradeRow(both)).toEqual([
      "aca-grade",
      "ACA grade",
      "3B",
      "string",
    ]);
    expect(acaGradeRow({ aca_technical: 3 })).toBeNull();
    expect(acaGradeRow({ v_grade: 3 })).toBeNull();
  });

  // Mutation: drop `acaGradeRow` from `canyonGradeRows`.
  it("follows the Grade row, before the other attributes", () => {
    const rows: AttributeRow[] = [["quality", "Quality", 4, "float"]];
    expect(canyonGradeRows(rows, { ...both, quality: 4 })).toEqual([
      ["canyon-grade", "Grade", "v3", "string"],
      ["aca-grade", "ACA grade", "3B", "string"],
      ["quality", "Quality", 4, "float"],
    ]);
  });

  // Mutation: key the row `aca_grade`, which a user's attribute labelled
  // "ACA grade" is stored under.
  it("is not keyed as a slug of any label", () => {
    const key = acaGradeRow(both)![0];
    expect(makeCustomFieldKey("ACA grade")).not.toBe(key);
    expect(makeCustomFieldKey(key)).not.toBe(key);
  });
});

describe("the grades a list sorts by", () => {
  // Mutation: return the French keys first for `aca`.
  it("puts the system in use first, then the other's two", () => {
    expect(gradeSortKeys("french")).toEqual([
      "v_grade",
      "a_grade",
      "aca_technical",
      "aca_water",
    ]);
    expect(gradeSortKeys("aca")).toEqual([
      "aca_technical",
      "aca_water",
      "v_grade",
      "a_grade",
    ]);
  });
});
