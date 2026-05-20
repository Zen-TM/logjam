import { describe, it, expect } from "vitest";
import { norm, stripWaterwaySuffix, nameMatchScore } from "./canyonNameMatch.js";

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

describe("nameMatchScore", () => {
  it("matches identical suffix-stripped names", () => {
    expect(nameMatchScore("Claustral", "Claustral Canyon").match).toBe(true);
  });
  it("matches via substring containment", () => {
    expect(nameMatchScore("Du Faurs Creek", "Du Faurs").match).toBe(true);
  });
  it("rejects unrelated names", () => {
    expect(nameMatchScore("Claustral", "Glow Worm Canyon").match).toBe(false);
  });
  it("matches strong token overlap", () => {
    const r = nameMatchScore("Bowens Creek North", "Bowens Creek South");
    expect(r.tokenJaccard).toBeGreaterThan(0);
    expect(r.sharedTokens).toBe(2); // "bowens" and "creek"
  });
});
