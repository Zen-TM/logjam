import { describe, it, expect } from "vitest";
import { parseFloatStrict, parseIntStrict, parseLatLng } from "./canyonValueParsers";

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
    expect(parseFloatStrict("abc")).toEqual({ ok: false, reason: "nonNumeric", raw: "abc" });
  });
});

describe("parseIntStrict", () => {
  it("accepts an in-range integer for the role", () => {
    expect(parseIntStrict("4", "vGrade")).toEqual({ ok: true, value: 4 });
  });
  it("rejects a decimal where an integer is required", () => {
    expect(parseIntStrict("3.5", "vGrade")).toMatchObject({ ok: false, reason: "decimalInInt" });
  });
  it("rejects booleanish words", () => {
    expect(parseIntStrict("yes", "wetsuits")).toMatchObject({ ok: false, reason: "booleanish" });
    expect(parseIntStrict("no", "wetsuits")).toMatchObject({ ok: false, reason: "booleanish" });
  });
  it("flags a likely scale mismatch (just above max, within 2x)", () => {
    // quality range is [1,5]; 8 ≤ 10 → scaleMismatch
    expect(parseIntStrict("8", "quality")).toMatchObject({ ok: false, reason: "scaleMismatch" });
  });
  it("flags out-of-range beyond 2x max", () => {
    expect(parseIntStrict("11", "quality")).toMatchObject({ ok: false, reason: "outOfRange" });
  });
  it("rejects a non-numeric string", () => {
    expect(parseIntStrict("abc", "vGrade")).toMatchObject({ ok: false, reason: "nonNumeric" });
  });
});

describe("parseLatLng", () => {
  it("parses decimal degrees", () => {
    expect(parseLatLng("-33.5")).toEqual({ ok: true, value: -33.5 });
  });
  it("returns coordFormat for DMS notation (not auto-converted)", () => {
    expect(parseLatLng("33°44'00\"S")).toMatchObject({ ok: false, reason: "coordFormat" });
  });
  it("returns nonNumeric for unrecognised text", () => {
    expect(parseLatLng("somewhere")).toMatchObject({ ok: false, reason: "nonNumeric" });
  });
  it("treats empty as NaN", () => {
    const r = parseLatLng("");
    expect(r.ok).toBe(true);
    expect(Number.isNaN((r as { value: number }).value)).toBe(true);
  });
});
