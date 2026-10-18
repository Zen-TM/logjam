import { describe, expect, it } from "vitest";
import { areaSizeLabel, scaleChoice } from "./geoPdfArea";

// Mutations: drop `otherPicked ||` (Other closes while a preset's number is
// typed into it); compare with a tolerance instead of exactly (a derived
// 24 998 lights 1:25 000 and is printed as if it were).
describe("scaleChoice", () => {
  it("lights a preset only for its exact scale", () => {
    expect(scaleChoice(25000, false)).toBe("25000");
    expect(scaleChoice(24998, false)).toBe("other");
  });

  it("stays on Other once picked, even at a preset", () => {
    expect(scaleChoice(25000, true)).toBe("other");
  });
});

describe("areaSizeLabel", () => {
  it("is in km from a kilometre, in m below", () => {
    expect(areaSizeLabel(4750, 6925)).toBe("4.8 × 6.9 km");
    expect(areaSizeLabel(380, 554)).toBe("380 × 554 m");
  });
});
