import { describe, it, expect } from "vitest";
import {
  isValidLatitude,
  isValidLongitude,
  invalidPlaceFields,
  numericConstraintError,
  validatePlacePayload,
  constraintFromDef,
  validateFieldValues,
} from "./placeValidation.js";
import { SYSTEM_FIELD_DEFS } from "./placeTypes.js";

describe("isValidLatitude", () => {
  it("accepts in-range values incl. bounds", () => {
    expect(isValidLatitude(0)).toBe(true);
    expect(isValidLatitude(-90)).toBe(true);
    expect(isValidLatitude(90)).toBe(true);
    expect(isValidLatitude(-33.71)).toBe(true);
  });
  it("rejects out-of-range values (the PLACE-1 case)", () => {
    expect(isValidLatitude(95)).toBe(false);
    expect(isValidLatitude(-90.0001)).toBe(false);
  });
  it("rejects non-finite and non-number", () => {
    expect(isValidLatitude(NaN)).toBe(false);
    expect(isValidLatitude(Infinity)).toBe(false);
    expect(isValidLatitude("45")).toBe(false);
    expect(isValidLatitude(null)).toBe(false);
    expect(isValidLatitude(undefined)).toBe(false);
  });
});

describe("isValidLongitude", () => {
  it("accepts in-range incl. bounds", () => {
    expect(isValidLongitude(-180)).toBe(true);
    expect(isValidLongitude(180)).toBe(true);
    expect(isValidLongitude(150.3)).toBe(true);
  });
  it("rejects out-of-range (the PLACE-1 case)", () => {
    expect(isValidLongitude(200)).toBe(false);
    expect(isValidLongitude(-181)).toBe(false);
  });
});

// The bounds under test are the SYSTEM DEFINITIONS' own, so this suite fails
// if a system field's bounds ever change — which is the point. The hardcoded
// PLACE_NUMERIC_CONSTRAINTS table these cases used to read is gone; there is
// one declaration now (shared/src/placeTypes.ts) and this reads it.
const defOf = (key: string) => {
  const def = SYSTEM_FIELD_DEFS.find((d) => d.key === key);
  if (!def) throw new Error(`no system def keyed ${key}`);
  return def;
};
const CONSTRAINT = {
  quality: constraintFromDef(defOf("quality"))!,
  numAbseils: constraintFromDef(defOf("num_abseils"))!,
  vGrade: constraintFromDef(defOf("v_grade"))!,
  hours: constraintFromDef(defOf("hours"))!,
};

describe("constraintFromDef", () => {
  it("carries a one-sided bound rather than inventing a ceiling", () => {
    expect(CONSTRAINT.numAbseils).toEqual({
      min: 0,
      max: null,
      integer: true,
      label: "Pitches",
    });
  });

  it("keeps the integer rule for an unbounded integer field", () => {
    expect(constraintFromDef({ label: "Count", type: "integer" })).toEqual({
      min: null,
      max: null,
      integer: true,
      label: "Count",
    });
  });

  it("has nothing to enforce for an unbounded float", () => {
    expect(constraintFromDef({ label: "Depth", type: "float" })).toBeNull();
  });

  it("has nothing to enforce for a non-numeric field", () => {
    expect(constraintFromDef({ label: "Notes", type: "string" })).toBeNull();
  });
});

describe("numericConstraintError", () => {
  it("passes valid values", () => {
    expect(
      numericConstraintError(3, CONSTRAINT.quality),
    ).toBeNull();
    expect(
      numericConstraintError(0, CONSTRAINT.numAbseils),
    ).toBeNull();
    expect(
      numericConstraintError(4, CONSTRAINT.vGrade),
    ).toBeNull();
  });
  it("rejects negatives on count/length/duration fields (PLACE-2)", () => {
    expect(
      numericConstraintError(-3, CONSTRAINT.numAbseils),
    ).toBe("Pitches cannot be negative");
    expect(
      numericConstraintError(-1, CONSTRAINT.hours),
    ).toBe("Hours cannot be negative");
  });
  it("rejects non-integers on integer fields", () => {
    expect(
      numericConstraintError(2.5, CONSTRAINT.numAbseils),
    ).toBe("Pitches must be a whole number");
  });
  it("enforces the quality scale (1-5)", () => {
    expect(
      numericConstraintError(0.5, CONSTRAINT.quality),
    ).toBe("Quality must be between 1 and 5");
    expect(
      numericConstraintError(6, CONSTRAINT.quality),
    ).toBe("Quality must be between 1 and 5");
  });
  it("rejects NaN", () => {
    expect(
      numericConstraintError(NaN, CONSTRAINT.hours),
    ).toBe("Hours must be a number");
  });
});

describe("validatePlacePayload", () => {
  it("accepts a valid create payload", () => {
    expect(
      validatePlacePayload(
        {
          latitude: -33.71,
          longitude: 150.3,
          fieldValues: { num_abseils: 4, quality: 3 },
        },
        { requireCoords: true, defs: SYSTEM_FIELD_DEFS },
      ),
    ).toBeNull();
  });
  it("rejects out-of-range latitude on create (PLACE-1)", () => {
    expect(
      validatePlacePayload(
        { latitude: 95, longitude: 200 },
        { requireCoords: true },
      ),
    ).toBe("Latitude must be a number between -90 and 90");
  });
  it("rejects out-of-range longitude when latitude is fine", () => {
    expect(
      validatePlacePayload(
        { latitude: -33, longitude: 200 },
        { requireCoords: true },
      ),
    ).toBe("Longitude must be a number between -180 and 180");
  });
  it("requires coordinates on create when absent", () => {
    expect(
      validatePlacePayload(
        { fieldValues: { num_abseils: 3 } },
        { requireCoords: true, defs: SYSTEM_FIELD_DEFS },
      ),
    ).toBe("Latitude must be a number between -90 and 90");
  });
  it("skips absent coordinates on patch", () => {
    expect(
      validatePlacePayload(
        { fieldValues: { num_abseils: 3 } },
        { requireCoords: false, defs: SYSTEM_FIELD_DEFS },
      ),
    ).toBeNull();
  });
  it("still validates a supplied coordinate on patch", () => {
    expect(
      validatePlacePayload({ latitude: 95 }, { requireCoords: false }),
    ).toBe("Latitude must be a number between -90 and 90");
  });
  it("rejects a negative numeric field (PLACE-2)", () => {
    expect(
      validatePlacePayload(
        { latitude: -33, longitude: 150, fieldValues: { num_abseils: -3 } },
        { requireCoords: true, defs: SYSTEM_FIELD_DEFS },
      ),
    ).toBe("Pitches cannot be negative");
  });
  it("ignores null numeric fields (unset)", () => {
    expect(
      validatePlacePayload(
        {
          latitude: -33,
          longitude: 150,
          fieldValues: { num_abseils: null, quality: null },
        },
        { requireCoords: true, defs: SYSTEM_FIELD_DEFS },
      ),
    ).toBeNull();
  });
  it("rejects a non-number numeric field", () => {
    expect(
      validatePlacePayload(
        { latitude: -33, longitude: 150, fieldValues: { quality: "abc" } },
        { requireCoords: true, defs: SYSTEM_FIELD_DEFS },
      ),
    ).toBe("Quality must be a number");
  });
});

describe("invalidPlaceFields", () => {
  it("names every out-of-range field, not just the first", () => {
    // validatePlacePayload answers with ONE sentence because an API rejection
    // is one message. The client needs the names: a parked op carries several
    // dirty fields and usually only one is the problem.
    // The whole blob is ONE dirty field on the wire, so `fieldValues` is the
    // granularity the client can act on — it cannot resend half a JSON column.
    expect(
      invalidPlaceFields(
        { fieldValues: { v_grade: 9, quality: 3, hours: -1 } },
        SYSTEM_FIELD_DEFS,
      ),
    ).toEqual(["fieldValues"]);
  });

  it("passes a payload the API would accept", () => {
    expect(
      invalidPlaceFields(
        { notes: "rebolted", fieldValues: { v_grade: 4, longest_abseil: 32 } },
        SYSTEM_FIELD_DEFS,
      ),
    ).toEqual([]);
  });

  it("says nothing about fields it has no constraint for", () => {
    // An empty list means "can't tell", never "everything is fine" — a
    // rejection for an unknown field or a server-side rule looks like this.
    expect(invalidPlaceFields({ notes: "x", name: "y" }, SYSTEM_FIELD_DEFS)).toEqual(
      [],
    );
  });

  it("catches a coordinate, which is the one a create op carries", () => {
    expect(
      invalidPlaceFields({ latitude: 91, longitude: 150 }, SYSTEM_FIELD_DEFS),
    ).toEqual(["latitude"]);
  });

  it("treats a non-number in a numeric field as invalid", () => {
    expect(
      invalidPlaceFields({ fieldValues: { hours: "six" } }, SYSTEM_FIELD_DEFS),
    ).toEqual(["fieldValues"]);
  });

  it("ignores an explicit null, which clears the field rather than setting it", () => {
    expect(
      invalidPlaceFields({ fieldValues: { v_grade: null } }, SYSTEM_FIELD_DEFS),
    ).toEqual([]);
  });
});


describe("validateFieldValues", () => {
  it("enforces a definition's bounds", () => {
    expect(
      validateFieldValues({ v_grade: 9 }, SYSTEM_FIELD_DEFS),
    ).toBe("V grade must be between 1 and 7");
  });

  it("enforces a one-sided bound without inventing the other end", () => {
    expect(validateFieldValues({ num_abseils: -1 }, SYSTEM_FIELD_DEFS)).toBe(
      "Pitches cannot be negative",
    );
    expect(validateFieldValues({ num_abseils: 900 }, SYSTEM_FIELD_DEFS)).toBeNull();
  });

  it("type-checks non-numeric fields too", () => {
    expect(validateFieldValues({ is_cave: "yes" }, SYSTEM_FIELD_DEFS)).toBe(
      "Is a cave? must be true or false",
    );
  });

  // A def can be deleted or rescoped while values are already stored, and the
  // trip-log union rule keeps showing a value whose def no longer applies
  // rather than destroying it. Rejecting here would make that unsaveable.
  it("leaves a value with no definition alone rather than rejecting it", () => {
    expect(
      validateFieldValues({ some_deleted_field: "kept" }, SYSTEM_FIELD_DEFS),
    ).toBeNull();
  });

  it("ignores nulls, which mean 'unset' rather than a value", () => {
    expect(validateFieldValues({ v_grade: null }, SYSTEM_FIELD_DEFS)).toBeNull();
  });
});
