import { describe, expect, it } from "vitest";

import {
  addMonths,
  fromDateKey,
  monthGrid,
  monthOf,
  todayDateKey,
  toDateKey,
  yearBlockStart,
} from "./monthGrid";

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
    expect(cells).toHaveLength(42);
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

  it("is always six rows, so the grid never changes height", () => {
    // February 2026 needs five rows, August 2026 needs six; both pad to 42 so
    // paging between them can't resize the sheet.
    for (const month of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      expect(monthGrid({ year: 2026, month })).toHaveLength(42);
    }
    expect(monthGrid({ year: 2024, month: 1 })).toHaveLength(42);
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

describe("todayDateKey", () => {
  it("reads the LOCAL calendar day, not the UTC one", () => {
    // 00:30 on 26 July in AEST (UTC+10) is still 25 July in UTC. A trip logged
    // then belongs to the 26th, and the 26th must not be a disabled future day.
    const justAfterLocalMidnight = new Date(2026, 6, 26, 0, 30);
    expect(todayDateKey(justAfterLocalMidnight)).toBe("2026-07-26");
  });

  it("zero-pads month and day", () => {
    expect(todayDateKey(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
  });
});

describe("yearBlockStart", () => {
  it("aligns blocks to end on a multiple of the size", () => {
    expect(yearBlockStart(2026, 20)).toBe(2021);
    expect(yearBlockStart(2021, 20)).toBe(2021);
    expect(yearBlockStart(2040, 20)).toBe(2021);
    expect(yearBlockStart(2041, 20)).toBe(2041);
    expect(yearBlockStart(2020, 20)).toBe(2001);
    expect(yearBlockStart(2000, 20)).toBe(1981);
  });

  it("puts a year in the same block regardless of which year you ask from", () => {
    // The point of fixed blocks: every year in a block agrees on the block.
    const block = yearBlockStart(2026, 20);
    for (let year = block; year < block + 20; year += 1) {
      expect(yearBlockStart(year, 20)).toBe(block);
    }
  });
});
