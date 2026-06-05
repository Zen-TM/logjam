import { describe, it, expect } from "vitest";
import { detectMismatches } from "./mismatchDetection";
import type { CanyonFieldRole } from "./canyonColumns";

const assign = (h: string, role: CanyonFieldRole) => ({ [h]: role });

describe("detectMismatches", () => {
  it("reports a typed column with a single failure kind", () => {
    const rows = [{ V: "3" }, { V: "4" }, { V: "abc" }];
    const result = detectMismatches(rows, assign("V", "vGrade"));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ csvHeader: "V", role: "vGrade", kind: "nonNumeric", badRowCount: 1 });
  });

  it("reports mixedTypes when failures span multiple kinds", () => {
    const rows = [{ V: "abc" }, { V: "3.5" }]; // nonNumeric + decimalInInt
    const result = detectMismatches(rows, assign("V", "vGrade"));
    expect(result[0].kind).toBe("mixedTypes");
  });

  it("skips untyped roles (name/notes/discard)", () => {
    const rows = [{ N: "anything" }];
    expect(detectMismatches(rows, assign("N", "name"))).toEqual([]);
    expect(detectMismatches(rows, assign("N", "notes"))).toEqual([]);
    expect(detectMismatches(rows, assign("N", "discard"))).toEqual([]);
  });

  it("ignores empty cells when counting", () => {
    const rows = [{ V: "3" }, { V: "" }, { V: "  " }];
    expect(detectMismatches(rows, assign("V", "vGrade"))).toEqual([]);
  });

  it("caps sampleBadRows at 5", () => {
    const rows = Array.from({ length: 8 }, () => ({ V: "abc" }));
    const result = detectMismatches(rows, assign("V", "vGrade"));
    expect(result[0].sampleBadRows.length).toBe(5);
    expect(result[0].badRowCount).toBe(8);
  });
});
