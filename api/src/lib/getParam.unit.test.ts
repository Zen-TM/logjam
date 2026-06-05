import { describe, it, expect } from "vitest";
import { getParam } from "./getParam";

describe("getParam", () => {
  it("returns the string unchanged", () => {
    expect(getParam("abc")).toBe("abc");
  });
  it("returns the first element of a string array", () => {
    expect(getParam(["first", "second"])).toBe("first");
  });
  it("handles an empty string", () => {
    expect(getParam("")).toBe("");
  });
});
