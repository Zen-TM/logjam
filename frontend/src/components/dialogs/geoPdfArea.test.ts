import { describe, expect, it } from "vitest";
import { scaleChoice, sheetSizeLabel } from "./geoPdfArea";

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

// Width first, each side in its own unit. Mutation: swap the two sides (a
// portrait sheet reads as landscape).
describe("sheetSizeLabel", () => {
  it("is width × height, in km from a kilometre and m below", () => {
    expect(sheetSizeLabel(4750, 6925)).toBe("4.8 km × 6.9 km");
    expect(sheetSizeLabel(380, 554)).toBe("380 m × 554 m");
  });
});
