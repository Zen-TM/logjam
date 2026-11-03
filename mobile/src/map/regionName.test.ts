import { describe, expect, it } from "vitest";

import { defaultRegionName, nextRegionName } from "./regionName";

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

describe("defaultRegionName", () => {
  const places = [
    { name: "Claustral Canyon", latitude: -33.66, longitude: 150.3 },
    { name: "Far Falls", latitude: -34.5, longitude: 151.5 },
  ];
  const near = { lat: -33.65, lng: 150.31 };

  it("names the area for the nearest place of the user's own", () => {
    expect(defaultRegionName(near, places, [])).toBe("Claustral Canyon");
  });

  it("numbers a second area for the same place", () => {
    expect(defaultRegionName(near, places, ["Claustral Canyon"])).toBe(
      "Claustral Canyon 2",
    );
  });

  it("falls back to the counter when no place is near", () => {
    expect(defaultRegionName({ lat: -30, lng: 145 }, places, [])).toBe(
      "Region 1",
    );
    expect(defaultRegionName(null, places, ["Region 1"])).toBe("Region 2");
  });
});
