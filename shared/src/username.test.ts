import { describe, it, expect } from "vitest";
import { isValidUsername } from "./username.js";

describe("isValidUsername", () => {
  it("accepts 3 to 32 letters, digits, dots, dashes and underscores, trimmed", () => {
    for (const ok of ["abc", " a.b-c_9 ", "x".repeat(32)]) {
      expect(isValidUsername(ok)).toBe(true);
    }
  });

  // Mutation: widen the pattern or move a bound and one of these goes green.
  it("refuses short, long and other characters", () => {
    for (const bad of ["ab", "x".repeat(33), "a b c", "al@ce", "ünï", ""]) {
      expect(isValidUsername(bad)).toBe(false);
    }
  });
});
