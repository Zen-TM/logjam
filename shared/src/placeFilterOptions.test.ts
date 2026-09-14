import { describe, expect, it } from "vitest";
import { filterPillStops } from "./placeFilterOptions.js";
import { SYSTEM_FIELD_DEFS } from "./placeTypes.js";

const system = (key: string) => {
  const def = SYSTEM_FIELD_DEFS.find((candidate) => candidate.key === key);
  if (!def) throw new Error(`no system field ${key}`);
  return def;
};

describe("filterPillStops", () => {
  it("draws a bounded whole-number axis as pills, whoever owns it", () => {
    expect(filterPillStops(system("v_grade"))).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(filterPillStops({ type: "integer", min: 1, max: 5 })).toEqual([1, 2, 3, 4, 5]);
  });

  it("draws quality as pills too, although it is a float", () => {
    // Canyon and campsite share this definition; they used to get pills and
    // two number boxes respectively, because one of them had a bespoke control.
    expect(filterPillStops(system("quality"))).toEqual([1, 2, 3, 4, 5]);
  });

  it("refuses anything that is not a small bounded whole-number axis", () => {
    expect(filterPillStops(system("hours"))).toBeNull();
    expect(filterPillStops(system("capacity"))).toBeNull();
    expect(filterPillStops(system("is_cave"))).toBeNull();
    expect(filterPillStops({ type: "float", min: 0.5, max: 3 })).toBeNull();
    expect(filterPillStops({ type: "integer", min: 0, max: 100 })).toBeNull();
    expect(filterPillStops({ type: "integer", min: 3, max: 3 })).toBeNull();
  });
});
