import { describe, it, expect } from "vitest";
import {
  isValidLatitude,
  isValidLongitude,
  numericConstraintError,
  validateCanyonPayload,
  CANYON_NUMERIC_CONSTRAINTS,
} from "./canyonValidation.js";

describe("isValidLatitude", () => {
  it("accepts in-range values incl. bounds", () => {
    expect(isValidLatitude(0)).toBe(true);
    expect(isValidLatitude(-90)).toBe(true);
    expect(isValidLatitude(90)).toBe(true);
    expect(isValidLatitude(-33.71)).toBe(true);
  });
  it("rejects out-of-range values (the CANYON-1 case)", () => {
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
  it("rejects out-of-range (the CANYON-1 case)", () => {
    expect(isValidLongitude(200)).toBe(false);
    expect(isValidLongitude(-181)).toBe(false);
  });
});

describe("numericConstraintError", () => {
  it("passes valid values", () => {
    expect(
      numericConstraintError(3, CANYON_NUMERIC_CONSTRAINTS.quality),
    ).toBeNull();
    expect(
      numericConstraintError(0, CANYON_NUMERIC_CONSTRAINTS.numAbseils),
    ).toBeNull();
    expect(
      numericConstraintError(4, CANYON_NUMERIC_CONSTRAINTS.vGrade),
    ).toBeNull();
  });
  it("rejects negatives on count/length/duration fields (CANYON-2)", () => {
    expect(
      numericConstraintError(-3, CANYON_NUMERIC_CONSTRAINTS.numAbseils),
    ).toBe("Pitches cannot be negative");
    expect(
      numericConstraintError(-1, CANYON_NUMERIC_CONSTRAINTS.hours),
    ).toBe("Hours cannot be negative");
  });
  it("rejects non-integers on integer fields", () => {
    expect(
      numericConstraintError(2.5, CANYON_NUMERIC_CONSTRAINTS.numAbseils),
    ).toBe("Pitches must be a whole number");
  });
  it("enforces the quality scale (1-5)", () => {
    expect(
      numericConstraintError(0.5, CANYON_NUMERIC_CONSTRAINTS.quality),
    ).toBe("Quality must be between 1 and 5");
    expect(
      numericConstraintError(6, CANYON_NUMERIC_CONSTRAINTS.quality),
    ).toBe("Quality must be between 1 and 5");
  });
  it("rejects NaN", () => {
    expect(
      numericConstraintError(NaN, CANYON_NUMERIC_CONSTRAINTS.hours),
    ).toBe("Hours must be a number");
  });
});

describe("validateCanyonPayload", () => {
  it("accepts a valid create payload", () => {
    expect(
      validateCanyonPayload(
        { latitude: -33.71, longitude: 150.3, numAbseils: 4, quality: 3 },
        { requireCoords: true },
      ),
    ).toBeNull();
  });
  it("rejects out-of-range latitude on create (CANYON-1)", () => {
    expect(
      validateCanyonPayload(
        { latitude: 95, longitude: 200 },
        { requireCoords: true },
      ),
    ).toBe("Latitude must be a number between -90 and 90");
  });
  it("rejects out-of-range longitude when latitude is fine", () => {
    expect(
      validateCanyonPayload(
        { latitude: -33, longitude: 200 },
        { requireCoords: true },
      ),
    ).toBe("Longitude must be a number between -180 and 180");
  });
  it("requires coordinates on create when absent", () => {
    expect(
      validateCanyonPayload({ numAbseils: 3 }, { requireCoords: true }),
    ).toBe("Latitude must be a number between -90 and 90");
  });
  it("skips absent coordinates on patch", () => {
    expect(
      validateCanyonPayload({ numAbseils: 3 }, { requireCoords: false }),
    ).toBeNull();
  });
  it("still validates a supplied coordinate on patch", () => {
    expect(
      validateCanyonPayload({ latitude: 95 }, { requireCoords: false }),
    ).toBe("Latitude must be a number between -90 and 90");
  });
  it("rejects a negative numeric field (CANYON-2)", () => {
    expect(
      validateCanyonPayload(
        { latitude: -33, longitude: 150, numAbseils: -3 },
        { requireCoords: true },
      ),
    ).toBe("Pitches cannot be negative");
  });
  it("ignores null numeric fields (unset)", () => {
    expect(
      validateCanyonPayload(
        { latitude: -33, longitude: 150, numAbseils: null, quality: null },
        { requireCoords: true },
      ),
    ).toBeNull();
  });
  it("rejects a non-number numeric field", () => {
    expect(
      validateCanyonPayload(
        { latitude: -33, longitude: 150, quality: "abc" },
        { requireCoords: true },
      ),
    ).toBe("Quality must be a number");
  });
});
