import { describe, expect, it } from "vitest";

import { addMonths, fromDateKey, monthGrid, monthOf, toDateKey } from "./monthGrid";

describe("date keys", () => {
  it("round-trips through UTC midnight", () => {
    expect(toDateKey(fromDateKey("2026-03-15"))).toBe("2026-03-15");
    expect(fromDateKey("2026-03-15").toISOString()).toBe("2026-03-15T00:00:00.000Z");
  });

  it("rejects a non-date", () => {
    expect(() => fromDateKey("not-a-date")).toThrow(/Not a date key/);
  });
});

describe("addMonths", () => {
  it("wraps forward and backward across years", () => {
    expect(addMonths({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(addMonths({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
    expect(addMonths({ year: 2026, month: 5 }, 0)).toEqual({ year: 2026, month: 5 });
    expect(addMonths({ year: 2026, month: 5 }, -18)).toEqual({ year: 2024, month: 11 });
  });
});

describe("monthOf", () => {
  it("reads the month in UTC", () => {
    expect(monthOf("2026-01-01")).toEqual({ year: 2026, month: 0 });
  });
});

describe("monthGrid", () => {
  it("pads to whole Monday-first weeks", () => {
    // 1 March 2026 is a Sunday → six leading blanks.
    const cells = monthGrid({ year: 2026, month: 2 });
    expect(cells.length % 7).toBe(0);
    expect(cells.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(cells[6]).toBe("2026-03-01");
    expect(cells.filter((cell) => cell !== null)).toHaveLength(31);
    expect(cells[cells.length - 1]).toBeNull();
  });

  it("starts flush when the 1st is a Monday", () => {
    // 1 June 2026 is a Monday.
    const cells = monthGrid({ year: 2026, month: 5 });
    expect(cells[0]).toBe("2026-06-01");
  });

  it("handles a leap February", () => {
    const cells = monthGrid({ year: 2024, month: 1 }).filter((cell) => cell !== null);
    expect(cells).toHaveLength(29);
    expect(cells[28]).toBe("2024-02-29");
  });

  it("keeps days contiguous and in order", () => {
    const cells = monthGrid({ year: 2026, month: 6 }).filter((cell) => cell !== null);
    expect(cells[0]).toBe("2026-07-01");
    expect(cells[cells.length - 1]).toBe("2026-07-31");
  });
});
