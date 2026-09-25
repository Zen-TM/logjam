import { describe, expect, it } from "vitest";

import { nextRegionName } from "./regionName";

describe("nextRegionName", () => {
  it("starts at 1 on a fresh phone", () => {
    expect(nextRegionName([])).toBe("Region 1");
  });

  it("skips the numbers already in use", () => {
    expect(nextRegionName(["Region 1", "Region 2"])).toBe("Region 3");
  });

  it("fills a gap left by a deleted region", () => {
    expect(nextRegionName(["Region 1", "Region 3"])).toBe("Region 2");
  });

  it("ignores user-chosen names and unlabelled rows", () => {
    expect(nextRegionName([null, "Claustral", "Region 1"])).toBe("Region 2");
  });
});
