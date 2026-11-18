import { describe, expect, it } from "vitest";
import {
  longMonth,
  longWeekday,
  monthInitial,
  shortMonth,
  shortWeekday,
} from "./dateNames.js";
import { PSEUDO_LANGUAGE } from "./i18n.js";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("date names", () => {
  // Mutation: drop or reorder a weekday in `SHORT_WEEKDAYS` or `LONG_WEEKDAYS`, and every date after it reads wrong.
  it("index the weekdays as Date#getDay counts, Sunday first", () => {
    // 1 January 2023 was a Sunday.
    for (const day of range(7)) {
      const date = new Date(2023, 0, 1 + day);
      expect(shortWeekday(date.getDay())).toBe(
        date.toLocaleDateString("en-AU", { weekday: "short" }),
      );
      expect(longWeekday(date.getDay())).toBe(
        date.toLocaleDateString("en-AU", { weekday: "long" }),
      );
    }
  });

  // Mutation: drop or reorder a month in `SHORT_MONTHS`, `LONG_MONTHS` or `MONTH_INITIALS`, and every date after it reads wrong.
  it("index the months as Date#getMonth counts, January first", () => {
    expect(range(12).map(shortMonth).join(" ")).toBe(
      "Jan Feb Mar Apr May Jun Jul Aug Sept Oct Nov Dec",
    );
    expect(range(12).map(monthInitial).join("")).toBe("JFMAMJJASOND");
    for (const month of range(12)) {
      const date = new Date(2023, month, 15);
      expect(longMonth(month)).toBe(
        date.toLocaleDateString("en-AU", { month: "long" }),
      );
    }
  });

  // Mutation: read a `SHORT_MONTHS` entry without the optional call, so a stray index throws.
  it("read an index outside the week or the year as an empty string", () => {
    expect(shortWeekday(7)).toBe("");
    expect(longWeekday(-1)).toBe("");
    expect(shortMonth(12)).toBe("");
    expect(longMonth(NaN)).toBe("");
    expect(monthInitial(12)).toBe("");
  });

  // Mutation: write a name as a bare string instead of `t`, so the pseudo-language leaves it plain.
  it("go through the catalogue, so the pseudo-language wraps each", () => {
    (globalThis as { LOGJAM_LANGUAGE?: string }).LOGJAM_LANGUAGE =
      PSEUDO_LANGUAGE;
    try {
      const names = [
        ...range(7).flatMap((d) => [shortWeekday(d), longWeekday(d)]),
        ...range(12).flatMap((m) => [
          shortMonth(m),
          longMonth(m),
          monthInitial(m),
        ]),
      ];
      expect(names).toHaveLength(14 + 36);
      expect(names.filter((name) => !/^⟦.+⟧$/.test(name))).toEqual([]);
    } finally {
      delete (globalThis as { LOGJAM_LANGUAGE?: string }).LOGJAM_LANGUAGE;
    }
  });
});
