import { describe, expect, it } from "vitest";
import {
  fieldValue,
  numericFieldValue,
  setFieldValues,
  stringFieldValue,
  userFieldKeys,
} from "./fieldValues";

describe("fieldValues", () => {
  // Mutation: store the null in setFieldValues, or return it from fieldValue.
  it("treats a missing key and a stored null as the same: no value", () => {
    expect(fieldValue({ grade: null }, "grade")).toBeUndefined();
    expect(fieldValue({}, "grade")).toBeUndefined();
    expect(setFieldValues({ grade: 3, depth: 4 }, { grade: null })).toEqual({
      depth: 4,
    });
  });

  // Mutation: throw, or coerce, on a type mismatch.
  it("reads a wrong-typed value as absent rather than throwing", () => {
    expect(numericFieldValue({ grade: "3" }, "grade")).toBeUndefined();
    expect(numericFieldValue({ grade: Number.NaN }, "grade")).toBeUndefined();
    expect(stringFieldValue({ permit: 12 }, "permit")).toBeUndefined();
    expect(numericFieldValue("not a record", "grade")).toBeUndefined();
  });

  it("never lists an internal `_` key as a user field", () => {
    expect(userFieldKeys({ grade: 3, _sources: {} })).toEqual(["grade"]);
  });
});
