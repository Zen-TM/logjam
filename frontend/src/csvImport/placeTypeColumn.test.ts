import { describe, expect, it } from "vitest";
import { placeTypeOfFile } from "./placeTypeColumn";

const types = [
  { id: "t-canyon", name: "Canyon" },
  { id: "t-camp", name: "Campsite" },
];
const rows = (...names: string[]) => names.map((n) => ({ placeType: n }));

// Mutation: return the first row's type whatever the others say, or match on
// the case-sensitive name.
describe("placeTypeOfFile", () => {
  it("names the type every row agrees on, whatever its case", () => {
    expect(
      placeTypeOfFile(["placeType"], rows("campsite", "Campsite"), types),
    ).toEqual({ typeId: "t-camp", several: false, unknown: null });
  });

  it("reads the header the way the other columns are read", () => {
    expect(
      placeTypeOfFile(["Place type"], [{ "Place type": "Canyon" }], types),
    ).toEqual({ typeId: "t-canyon", several: false, unknown: null });
  });

  it("leaves old files, which have no such column, as they were", () => {
    expect(
      placeTypeOfFile(["name", "type"], [{ name: "x", type: "Canyon" }], types),
    ).toEqual({ typeId: null, several: false, unknown: null });
  });

  it("does not guess among several types, nor from an unknown name", () => {
    expect(
      placeTypeOfFile(["placeType"], rows("Canyon", "Campsite"), types),
    ).toEqual({ typeId: null, several: true, unknown: null });
    expect(placeTypeOfFile(["placeType"], rows("", ""), types)).toEqual({
      typeId: null,
      several: false,
      unknown: null,
    });
  });

  it("names a type the account does not have, as the file spells it", () => {
    expect(placeTypeOfFile(["placeType"], rows("Cave", "cave"), types)).toEqual(
      { typeId: null, several: false, unknown: "Cave" },
    );
  });

  // Mutation: drop `undoFormulaGuard`, and a type named -Hut is "not found".
  it("reads a type the export had to guard against a formula", () => {
    const hut = [{ id: "t-hut", name: "-Hut" }];
    expect(placeTypeOfFile(["placeType"], rows("'-Hut"), hut)).toEqual({
      typeId: "t-hut",
      several: false,
      unknown: null,
    });
  });
});
