import { describe, expect, it } from "vitest";

import { nextRegionName } from "./regionName";

describe("nextRegionName", () => {
  it("starts at 1 on a fresh phone", () => {
    expect(nextRegionName([])).toBe("Offline map 1");
  });

  it("skips the numbers already in use", () => {
    expect(nextRegionName(["Offline map 1", "Offline map 2"])).toBe(
      "Offline map 3",
    );
  });

  it("fills a gap left by a deleted offline map", () => {
    expect(nextRegionName(["Offline map 1", "Offline map 3"])).toBe(
      "Offline map 2",
    );
  });

  it("ignores user-chosen names and unlabelled rows", () => {
    expect(nextRegionName([null, "Claustral", "Offline map 1"])).toBe(
      "Offline map 2",
    );
  });
});
