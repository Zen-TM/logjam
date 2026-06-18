import { describe, it, expect } from "vitest";
import {
  sanitizeIntegerInput,
  sanitizeDecimalInput,
  sanitizeNumericInput,
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
