import { describe, expect, it } from "vitest";
import { formatTripCanyonNames, TRIP_TYPE_SUGGESTIONS } from "./tripName.js";

describe("formatTripCanyonNames", () => {
  it("returns null for an empty list", () => {
    expect(formatTripCanyonNames([])).toBeNull();
  });

  it("returns the single name unchanged", () => {
    expect(formatTripCanyonNames(["Claustral"])).toBe("Claustral");
  });

  it("joins two names with 'and'", () => {
    expect(formatTripCanyonNames(["Claustral", "Ranon"])).toBe(
      "Claustral and Ranon",
    );
  });

  it("comma-separates with 'and' before the last of three", () => {
    expect(
      formatTripCanyonNames(["Claustral", "Ranon", "Whungee Whengee"]),
    ).toBe("Claustral, Ranon and Whungee Whengee");
  });

  it("preserves order for four names", () => {
    expect(formatTripCanyonNames(["A", "B", "C", "D"])).toBe("A, B, C and D");
  });
});

describe("TRIP_TYPE_SUGGESTIONS", () => {
  it("includes the core seed types", () => {
    expect(TRIP_TYPE_SUGGESTIONS).toContain("canyoning");
    expect(TRIP_TYPE_SUGGESTIONS).toContain("bushwalking");
  });
});
