import { describe, expect, it } from "vitest";

import { isVersionBelowMinimum, parseSemver } from "./version";

describe("parseSemver", () => {
  it("parses a bare semver", () => {
    expect(parseSemver("1.22.333")).toEqual([1, 22, 333]);
  });

  it.each(["1.2", "v1.2.3", "1.2.3-beta", "mobile/1.2.3", "", "a.b.c"])(
    "throws on %j",
    (bad) => {
      expect(() => parseSemver(bad)).toThrow("Invalid semver");
    }
  );
});

describe("isVersionBelowMinimum", () => {
  it.each([
    ["0.1.0", "0.0.0", false],
    ["0.1.0", "0.1.0", false],
    ["0.1.0", "0.1.1", true],
    ["0.1.0", "0.2.0", true],
    ["0.1.0", "1.0.0", true],
    ["1.0.0", "0.9.9", false],
    // numeric compare, not lexicographic
    ["0.10.0", "0.9.0", false],
    ["0.9.0", "0.10.0", true],
  ])("current %s vs min %s → below=%s", (current, minimum, below) => {
    expect(isVersionBelowMinimum(current, minimum)).toBe(below);
  });
});
