import { describe, expect, it } from "vitest";
import { isValidLatitude } from "@logjam/shared";
import {
  coordinateBlur,
  coordinateProblem,
  coordinateText,
  coordinateValue,
  shownCoord,
} from "./coordinateText";

const STORED = -33.62912345;

describe("a place's coordinate field", () => {
  // Mutation: make `coordinateValue` return `parseNumber(typed)` for an
  // unedited field (rounds the position on open-and-save), or seed with
  // `String(stored)` instead of `shownCoord`.
  it("shows five places and still holds the stored value until it is edited", () => {
    expect(shownCoord(STORED)).toBe("-33.62912");
    expect(coordinateText(shownCoord(STORED), false, STORED)).toBe("-33.62912");
    expect(coordinateValue(shownCoord(STORED), false, STORED)).toBe(STORED);
  });

  // Mutation: compare the text with `shownCoord(stored)` instead of using the
  // flag (typing the shown text back would then keep the stored value).
  it("holds what was typed once it is edited, even the shown text", () => {
    expect(coordinateValue("-33.62912", true, STORED)).toBe(-33.62912);
    expect(coordinateValue("-34", true, STORED)).toBe(-34);
  });

  // Mutation: show `typed` for an unedited field (a sync clobbers again).
  it("follows the latest stored value while nobody has edited it", () => {
    expect(coordinateText("-33.62912", false, -35.5)).toBe("-35.5");
    expect(coordinateValue("-33.62912", false, -35.5)).toBe(-35.5);
  });

  it("is only its text for a new place", () => {
    expect(coordinateText("-33.1", false, undefined)).toBe("-33.1");
    expect(coordinateValue("-33.1", false, undefined)).toBe(-33.1);
    expect(coordinateValue("", false, undefined)).toBeNull();
  });

  // Mutation: return null for an empty field on an edit.
  it("is required on an edit: a cleared field is missing, not unchanged", () => {
    const shown = coordinateText("", true, STORED);
    expect(shown).toBe("");
    expect(coordinateValue("", true, STORED)).toBeNull();
    expect(
      coordinateProblem(shown, null, isValidLatitude, "missing", "invalid"),
    ).toBe("missing");
    expect(
      coordinateProblem("95", 95, isValidLatitude, "missing", "invalid"),
    ).toBe("invalid");
    expect(
      coordinateProblem("-33.6", -33.6, isValidLatitude, "missing", "invalid"),
    ).toBeNull();
  });

  // Mutation: return an error for an empty field.
  it("flags a bad entry on blur, normalises a good one and leaves an empty one alone", () => {
    expect(coordinateBlur("", isValidLatitude, "invalid")).toBeNull();
    expect(coordinateBlur("-33.6290 ", isValidLatitude, "invalid")).toEqual({
      text: "-33.629",
      error: null,
    });
    expect(coordinateBlur("95", isValidLatitude, "invalid")?.error).toBe(
      "invalid",
    );
    expect(coordinateBlur("abc", isValidLatitude, "invalid")?.error).toBe(
      "invalid",
    );
  });
});
