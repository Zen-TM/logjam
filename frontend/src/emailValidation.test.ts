import { describe, it, expect } from "vitest";
import { isValidEmailFormat } from "./emailValidation";

describe("isValidEmailFormat", () => {
  it("accepts ordinary addresses", () => {
    expect(isValidEmailFormat("alice@example.com")).toBe(true);
    expect(isValidEmailFormat("a.b+tag@sub.domain.co.uk")).toBe(true);
    expect(isValidEmailFormat("  trimmed@example.com  ")).toBe(true);
  });

  it("rejects obviously malformed input", () => {
    expect(isValidEmailFormat("")).toBe(false);
    expect(isValidEmailFormat("plainstring")).toBe(false);
    expect(isValidEmailFormat("no-at.example.com")).toBe(false);
    expect(isValidEmailFormat("missing@domain")).toBe(false);
    expect(isValidEmailFormat("@example.com")).toBe(false);
    expect(isValidEmailFormat("spaces in@example.com")).toBe(false);
    expect(isValidEmailFormat("trailing@example.")).toBe(false);
    expect(isValidEmailFormat("double@@example.com")).toBe(false);
  });
});
