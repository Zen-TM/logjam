import { describe, expect, it } from "vitest";
import { railStops, type TripLogCustomFieldDef } from "./tripLogFields.js";

const def = (over: Partial<TripLogCustomFieldDef>): TripLogCustomFieldDef => ({
  key: "k",
  label: "L",
  type: "integer",
  ...over,
});

describe("railStops", () => {
  // The canyon axes are the reason the rule exists, so they are what pins it:
  // they used to be seven hand-written controls that named their own keys.
  it("draws a bounded integer as its stops", () => {
    expect(railStops(def({ min: 1, max: 7 }))).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(railStops(def({ min: 1, max: 6 }))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("leaves a FLOAT alone, however tight its bounds", () => {
    // `quality` is 1-5 float. Drawn as a rail it could not express the 4.5 the
    // web stores — the stored value matched no stop, so the control showed
    // nothing selected and saving rounded it away.
    expect(railStops(def({ type: "float", min: 1, max: 5 }))).toBeNull();
  });

  it("leaves an unbounded number alone", () => {
    expect(railStops(def({ min: 0 }))).toBeNull();
    expect(railStops(def({ max: 10 }))).toBeNull();
    expect(railStops(def({}))).toBeNull();
  });

  it("stops being a rail when the stops stop being tappable", () => {
    // MAX_RAIL_STOPS is a count, not a span: 1-12 is exactly twelve stops and
    // still a rail, 1-13 is thirteen and gets a keyboard instead.
    expect(railStops(def({ min: 1, max: 12 }))).toHaveLength(12);
    expect(railStops(def({ min: 1, max: 13 }))).toBeNull();
    expect(railStops(def({ min: 0, max: 100 }))).toBeNull();
  });

  it("is not a rail when there is nothing to choose between", () => {
    expect(railStops(def({ min: 3, max: 3 }))).toBeNull();
  });

  it("handles negative bounds", () => {
    expect(railStops(def({ min: -2, max: 2 }))).toEqual([-2, -1, 0, 1, 2]);
  });

  it("is not a rail for a non-numeric type", () => {
    expect(railStops(def({ type: "boolean", min: 0, max: 1 }))).toBeNull();
    expect(railStops(def({ type: "string", min: 1, max: 5 }))).toBeNull();
  });
});
