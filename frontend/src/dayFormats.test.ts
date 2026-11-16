// Logjam Web's half of the day-forms pair; Logjam GPS's is mobile/src/dayFormats.test.ts.
// Both read shared/src/__fixtures__/day-formats.json, which holds what each form of
// `@logjam/shared`'s dateFormat.ts writes, and check the sites that draw one.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  dayOfKey,
  formatDayLongMonthYear,
  formatDayMonth,
  formatDayMonthYear,
  formatFullDay,
  formatLongMonthYear,
  formatMonthYear,
  formatNumericDay,
  formatWeekdayDay,
  formatWeekdayDayMonth,
  formatWeekdayDayMonthYear,
  formatWeekdayDayMonthYearComma,
  formatDayLongMonth,
} from "@logjam/shared";
import { describe, expect, it } from "vitest";
import { formatDay } from "./components/sidebar/panels/mapsModel";

const FIXTURE = JSON.parse(
  readFileSync(
    join(__dirname, "../../shared/src/__fixtures__/day-formats.json"),
    "utf8",
  ),
) as Record<string, Record<string, string>>;

function inTimeZone<T>(timeZone: string, run: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    return run();
  } finally {
    process.env.TZ = previous;
  }
}

const FORMS = {
  formatWeekdayDayMonthYear,
  formatWeekdayDayMonthYearComma,
  formatWeekdayDayMonth,
  formatWeekdayDay,
  formatDayMonthYear,
  formatDayMonth,
  formatMonthYear,
  formatDayLongMonth,
  formatDayLongMonthYear,
  formatLongMonthYear,
  formatFullDay,
  formatNumericDay,
};

describe("the day forms in Logjam Web", () => {
  // Mutation: give `formatDayMonthYear` the pattern `<month> <day> <year>`, and the fixture reads wrong here and in Logjam GPS.
  it("write what the fixture holds, as they do in Logjam GPS", () => {
    expect(Object.keys(FIXTURE)).toHaveLength(2);
    for (const [key, forms] of Object.entries(FIXTURE)) {
      for (const [name, text] of Object.entries(forms)) {
        expect(FORMS[name as keyof typeof FORMS](dayOfKey(key)), name).toBe(
          text,
        );
      }
    }
  });

  // Mutation: read `formatDay` (mapsModel.ts) with `utcDay` for `localDay`, and 07:00 on the 15th in Sydney reads as the 14th.
  it("draw a made-on day from the timestamp in local time", () => {
    inTimeZone("Australia/Sydney", () => {
      expect(formatDay("2026-03-14T20:00:00.000Z")).toBe(
        FIXTURE["2026-03-15"].formatDayMonthYear,
      );
      expect(formatDay("2025-09-07T20:00:00.000Z")).toBe(
        FIXTURE["2025-09-08"].formatDayMonthYear,
      );
    });
  });
});
