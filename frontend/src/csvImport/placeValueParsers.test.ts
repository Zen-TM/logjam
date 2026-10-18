import { describe, it, expect } from "vitest";
import {
  parseFloatStrict,
  parseIntStrict,
  parseLatLng,
} from "./placeValueParsers";

describe("parseFloatStrict", () => {
  it("parses a trimmed numeric string", () => {
    expect(parseFloatStrict("  12.5 ")).toEqual({ ok: true, value: 12.5 });
  });
  it("treats empty as NaN (no value)", () => {
    const r = parseFloatStrict("   ");
    expect(r.ok).toBe(true);
    expect(Number.isNaN((r as { value: number }).value)).toBe(true);
  });
  it("fails on a non-numeric string", () => {
    expect(parseFloatStrict("abc")).toEqual({
      ok: false,
      reason: "nonNumeric",
      raw: "abc",
    });
  });
  it("accepts an in-range decimal for a ranged role (quality)", () => {
    expect(parseFloatStrict("3.5", "quality")).toEqual({
      ok: true,
      value: 3.5,
    });
  });
  it("range-checks a ranged role (quality 1-5)", () => {
    expect(parseFloatStrict("8", "quality")).toMatchObject({
      ok: false,
      reason: "scaleMismatch",
    });
    expect(parseFloatStrict("11", "quality")).toMatchObject({
      ok: false,
      reason: "outOfRange",
    });
  });
});

describe("parseIntStrict", () => {
  it("accepts an in-range integer for the role", () => {
    expect(parseIntStrict("4", "vGrade")).toEqual({ ok: true, value: 4 });
  });
  it("rejects a decimal where an integer is required", () => {
    expect(parseIntStrict("3.5", "vGrade")).toMatchObject({
      ok: false,
      reason: "decimalInInt",
    });
  });
  it("rejects booleanish words", () => {
    expect(parseIntStrict("yes", "commitment")).toMatchObject({
      ok: false,
      reason: "booleanish",
    });
    expect(parseIntStrict("no", "commitment")).toMatchObject({
      ok: false,
      reason: "booleanish",
    });
  });
  it("flags a likely scale mismatch (just above max, within 2x)", () => {
    // quality range is [1,5]; 8 ≤ 10 → scaleMismatch
    expect(parseIntStrict("8", "quality")).toMatchObject({
      ok: false,
      reason: "scaleMismatch",
    });
  });
  it("flags out-of-range beyond 2x max", () => {
    expect(parseIntStrict("11", "quality")).toMatchObject({
      ok: false,
      reason: "outOfRange",
    });
  });
  it("rejects a non-numeric string", () => {
    expect(parseIntStrict("abc", "vGrade")).toMatchObject({
      ok: false,
      reason: "nonNumeric",
    });
  });
});

describe("parseLatLng", () => {
  it("parses decimal degrees", () => {
    expect(parseLatLng("-33.5")).toEqual({ ok: true, value: -33.5 });
  });
  it("converts DMS notation, south and west negative", () => {
    const v = (raw: string) => (parseLatLng(raw) as { value: number }).value;
    expect(v("33°30'00\"S")).toBeCloseTo(-33.5);
    expect(v("33° 33' 33.12\" S")).toBeCloseTo(-33.5592);
    expect(v("150 15 0 E")).toBeCloseTo(150.25);
    expect(v("150°15'00\"W")).toBeCloseTo(-150.25);
  });
  it("refuses minutes or seconds of 60 and over", () => {
    expect(parseLatLng("33 99 99 S")).toMatchObject({ ok: false });
  });
  it("reads a decimal comma", () => {
    expect(parseLatLng("-33,5603")).toEqual({ ok: true, value: -33.5603 });
  });
  it("returns nonNumeric for unrecognised text", () => {
    expect(parseLatLng("somewhere")).toMatchObject({
      ok: false,
      reason: "nonNumeric",
    });
  });
  it("treats empty as NaN", () => {
    const r = parseLatLng("");
    expect(r.ok).toBe(true);
    expect(Number.isNaN((r as { value: number }).value)).toBe(true);
  });
});
