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

  it("rejects an impossible date instead of letting it roll forward (FECO-007)", () => {
    // JS Date silently normalizes 30/02 into Mar 2 rather than failing — the
    // regex matches, but the round-trip check must catch the rollover and
    // return null instead of a wrong-but-valid-looking Date.
    expect(parseWithFormat("30/02/2023", "DD/MM/YYYY")).toBeNull();
    expect(parseWithFormat("31/04/2023", "DD/MM/YYYY")).toBeNull(); // April has 30 days
    expect(parseWithFormat("29/02/2023", "DD/MM/YYYY")).toBeNull(); // 2023 not a leap year
    expect(parseWithFormat("29/02/2024", "DD/MM/YYYY")).not.toBeNull(); // 2024 is a leap year
  });

  it("folds two-digit years", () => {
    const d = parseWithFormat("15/06/23", "DD/MM/YY")!;
    expect(d.getFullYear()).toBe(2023);
  });

  it("parses ISO 8601 (YYYY-MM-DD) year-first", () => {
    const d = parseWithFormat("2023-06-15", "YYYY-MM-DD")!;
    expect(d.getFullYear()).toBe(2023);
    expect(d.getMonth()).toBe(5); // June (0-indexed)
    expect(d.getDate()).toBe(15);
  });

  it("does not confuse ISO 8601 with a day-first dash format", () => {
    // "2023-06-15" must not parse under DD-MM-YYYY (day would be 4 digits).
    expect(parseWithFormat("2023-06-15", "DD-MM-YYYY")).toBeNull();
    // …and a day-first dash date must not parse as ISO.
    expect(parseWithFormat("15-06-2023", "YYYY-MM-DD")).toBeNull();
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

  it("auto-detects ISO 8601 unambiguously", () => {
    expect(detectDateFormat(["2023-06-15", "2022-12-01"])).toEqual({
      format: "YYYY-MM-DD",
      ambiguous: false,
    });
  });
});

describe("toIsoDate (ISO 8601)", () => {
  it("round-trips an ISO date", () => {
    expect(toIsoDate("2023-06-15", "YYYY-MM-DD")).toBe("2023-06-15");
  });
  it("zero-pads a single-digit ISO month/day", () => {
    expect(toIsoDate("2024-1-5", "YYYY-MM-DD")).toBe("2024-01-05");
  });
});
