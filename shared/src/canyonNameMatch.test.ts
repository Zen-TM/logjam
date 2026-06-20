import { describe, it, expect } from "vitest";
import { norm, stripWaterwaySuffix } from "./canyonNameMatch.js";

describe("norm", () => {
  it("lowercases and strips apostrophes", () => {
    expect(norm("Du Faur's")).toBe("du faurs");
    expect(norm("  CLAUSTRAL  ")).toBe("claustral");
  });
});

describe("stripWaterwaySuffix", () => {
  it("strips trailing waterway words", () => {
    expect(stripWaterwaySuffix("Claustral Canyon")).toBe("claustral");
    expect(stripWaterwaySuffix("Grand Gorge")).toBe("grand");
    expect(stripWaterwaySuffix("Wollangambe River")).toBe("wollangambe");
  });
  it("leaves names without suffix untouched", () => {
    expect(stripWaterwaySuffix("Claustral")).toBe("claustral");
  });
  it("does not strip when suffix is the entire name", () => {
    expect(stripWaterwaySuffix("Canyon")).toBe("canyon");
  });
});
