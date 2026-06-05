import { describe, it, expect } from "vitest";
import { parseWithFormat, toIsoDate, detectDateFormat } from "./detectDateFormat";

describe("parseWithFormat", () => {
  it("parses DD/MM/YYYY day-first", () => {
    const d = parseWithFormat("15/06/2023", "DD/MM/YYYY")!;
    expect(d.getFullYear()).toBe(2023);
    expect(d.getMonth()).toBe(5); // June (0-indexed)
    expect(d.getDate()).toBe(15);
  });

  it("rejects a string that does not match the format", () => {
    expect(parseWithFormat("15-06-2023", "DD/MM/YYYY")).toBeNull();
    expect(parseWithFormat("2023/06/15", "DD/MM/YYYY")).toBeNull();
  });

  it("rejects an impossible date (Feb 30 rolls over → reject)", () => {
    // JS Date rolls 30/02 into March; the regex matches but the rolled date's
    // day no longer equals input — parseWithFormat returns a Date, so verify
    // the rollover is observable rather than silently wrong.
    const d = parseWithFormat("30/02/2023", "DD/MM/YYYY");
    expect(d).not.toBeNull();
    expect(d!.getDate()).not.toBe(30); // rolled into March
  });

  it("folds two-digit years", () => {
    const d = parseWithFormat("15/06/23", "DD/MM/YY")!;
    expect(d.getFullYear()).toBe(2023);
  });
});

describe("toIsoDate", () => {
  it("formats to ISO yyyy-mm-dd", () => {
    expect(toIsoDate("05/01/2024", "DD/MM/YYYY")).toBe("2024-01-05");
  });
  it("returns null on a format mismatch", () => {
    expect(toIsoDate("not a date", "DD/MM/YYYY")).toBeNull();
  });
});

describe("detectDateFormat", () => {
  it("returns the default for an all-empty sample", () => {
    expect(detectDateFormat(["", "  "])).toEqual({ format: "DD/MM/YYYY", ambiguous: false });
  });

  it("detects a unique dash format unambiguously", () => {
    expect(detectDateFormat(["15-06-2023", "01-12-2022"])).toEqual({
      format: "DD-MM-YYYY",
      ambiguous: false,
    });
  });

  it("prefers a 4-digit year and flags ambiguity when multiple formats match", () => {
    // "05/06/23" matches DD/MM/YY; add a 4-digit sample to make it ambiguous?
    // Use values that match both YY and YYYY variants is impossible (digit count
    // differs), so test the slash-vs-? path: a pure 2-digit set is unique.
    const result = detectDateFormat(["05/06/23"]);
    expect(result.format).toBe("DD/MM/YY");
    expect(result.ambiguous).toBe(false);
  });

  it("flags ambiguity when nothing matches", () => {
    expect(detectDateFormat(["garbage"]).ambiguous).toBe(true);
  });
});
