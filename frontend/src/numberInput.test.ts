import { describe, it, expect } from "vitest";
import {
  sanitizeIntegerInput,
  sanitizeDecimalInput,
  sanitizeNumericInput,
  numericFieldError,
} from "./numberInput";

describe("sanitizeIntegerInput", () => {
  it("keeps digits", () => {
    expect(sanitizeIntegerInput("123")).toBe("123");
  });
  it("strips letters", () => {
    expect(sanitizeIntegerInput("1a2b3")).toBe("123");
    expect(sanitizeIntegerInput("abc")).toBe("");
  });
  it("rejects a decimal point", () => {
    expect(sanitizeIntegerInput("1.5")).toBe("15");
    expect(sanitizeIntegerInput("3.")).toBe("3");
  });
  it("allows a single leading minus only", () => {
    expect(sanitizeIntegerInput("-12")).toBe("-12");
    expect(sanitizeIntegerInput("1-2")).toBe("12");
    expect(sanitizeIntegerInput("--5")).toBe("-5");
  });
  it("passes empty through", () => {
    expect(sanitizeIntegerInput("")).toBe("");
  });
});

describe("sanitizeDecimalInput", () => {
  it("keeps a single decimal", () => {
    expect(sanitizeDecimalInput("3.5")).toBe("3.5");
    expect(sanitizeDecimalInput(".5")).toBe(".5");
    expect(sanitizeDecimalInput("3.")).toBe("3.");
  });
  it("collapses extra dots", () => {
    expect(sanitizeDecimalInput("3.5.2")).toBe("3.52");
    expect(sanitizeDecimalInput("1..2")).toBe("1.2");
  });
  it("strips letters and stray symbols", () => {
    expect(sanitizeDecimalInput("3a.5e")).toBe("3.5");
    expect(sanitizeDecimalInput("1e3")).toBe("13");
  });
  it("allows a single leading minus", () => {
    expect(sanitizeDecimalInput("-3.5")).toBe("-3.5");
    expect(sanitizeDecimalInput("3-.5")).toBe("3.5");
  });
});

describe("sanitizeNumericInput", () => {
  it("dispatches by type", () => {
    expect(sanitizeNumericInput("1.5", "integer")).toBe("15");
    expect(sanitizeNumericInput("1.5", "float")).toBe("1.5");
  });
});

describe("numericFieldError", () => {
  it("treats empty / lone-minus as unset (valid)", () => {
    expect(numericFieldError("", { min: 0 })).toBeNull();
    expect(numericFieldError("   ", { min: 0 })).toBeNull();
    expect(numericFieldError("-", { min: 0 })).toBeNull();
  });
  it("flags a decimal in an integer field instead of truncating (TRIP-1)", () => {
    expect(numericFieldError("5.5", { integer: true })).toBe("Whole numbers only");
    expect(numericFieldError("5", { integer: true })).toBeNull();
  });
  it("flags negatives on a non-negative field (CANYON-2/TRIP-2)", () => {
    expect(numericFieldError("-5", { min: 0 })).toBe("Cannot be negative");
    expect(numericFieldError("-5.5", { integer: true, min: 0 })).toBe(
      "Whole numbers only",
    );
    expect(numericFieldError("0", { min: 0 })).toBeNull();
  });
  it("enforces a bounded range (quality 1-5)", () => {
    expect(numericFieldError("0.5", { min: 1, max: 5 })).toBe(
      "Must be between 1 and 5",
    );
    expect(numericFieldError("6", { min: 1, max: 5 })).toBe(
      "Must be between 1 and 5",
    );
    expect(numericFieldError("3.5", { min: 1, max: 5 })).toBeNull();
  });
  it("enforces coordinate ranges (CANYON-1)", () => {
    expect(numericFieldError("95", { min: -90, max: 90 })).toBe(
      "Must be between -90 and 90",
    );
    expect(numericFieldError("200", { min: -180, max: 180 })).toBe(
      "Must be between -180 and 180",
    );
    expect(numericFieldError("-33.71", { min: -90, max: 90 })).toBeNull();
  });
  it("allows negatives when no min is set (e.g. unbounded temperature field)", () => {
    expect(numericFieldError("-5", { integer: true })).toBeNull();
  });
  it("rejects a value that isn't a number", () => {
    // sanitizeDecimalInput normally prevents this reaching the validator, but a
    // lone stray like "." should still be caught rather than passed through.
    expect(numericFieldError(".", {})).toBe("Enter a valid number");
  });
});
