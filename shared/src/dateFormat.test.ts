// Dates are written by one function family (dateFormat.ts). The expected text is in
// __fixtures__/day-formats.json, which frontend/src/dayFormats.test.ts and
// mobile/src/dayFormats.test.ts read too, so a form cannot read one way in a
// browser and another on a phone.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as dateFormat from "./dateFormat.js";
import { dayOfKey, localDay, utcDay } from "./dateFormat.js";

// en-US is empty in source; this is the order the reorder test needs.
vi.mock("./i18nCatalogues/en-US.js", () => ({
  enUS: {
    "<day> <month> <year>": "<month> <day>, <year>",
    "<weekday> <day> <month>": "<weekday>, <month> <day>",
  },
}));

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  readFileSync(join(HERE, "__fixtures__", "day-formats.json"), "utf8"),
) as Record<string, Record<string, string>>;
const FORMS = Object.entries(dateFormat).filter(([name]) =>
  name.startsWith("format"),
) as [string, (day: ReturnType<typeof dayOfKey>) => string][];

afterEach(() => {
  delete (globalThis as { LOGJAM_LANGUAGE?: string }).LOGJAM_LANGUAGE;
});

function inTimeZone<T>(timeZone: string, run: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    return run();
  } finally {
    process.env.TZ = previous;
  }
}

describe("the day forms", () => {
  // Mutation: swap the day and the month in `<day> <month> <year>`.
  it("write each form the way Logjam has always written it", () => {
    for (const [key, forms] of Object.entries(FIXTURE)) {
      for (const [name, text] of Object.entries(forms)) {
        const form = FORMS.find(([formName]) => formName === name)?.[1];
        expect(form, name).toBeDefined();
        expect(form!(dayOfKey(key)), `${name} ${key}`).toBe(text);
      }
    }
  });

  // Mutation: add an exported function whose name starts with "format" that the fixture lacks.
  it("are all in the fixture, so Logjam Web and Logjam GPS pin every one", () => {
    expect(FORMS.length).toBeGreaterThanOrEqual(11);
    for (const [key, forms] of Object.entries(FIXTURE)) {
      expect(Object.keys(forms).sort(), key).toEqual(
        FORMS.map(([name]) => name).sort(),
      );
    }
  });

  // Mutation: give two forms the same pattern, as the holes {0} {1} {2} would be for "Sat 8 Nov" and "15 Mar 2026".
  it("give every form a message of its own", () => {
    const source = readFileSync(join(HERE, "dateFormat.ts"), "utf8");
    const patterns = [...source.matchAll(/fill\(t`([^`]+)`/g)].map((m) => m[1]);
    expect(patterns.length).toBeGreaterThanOrEqual(11);
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  // Mutation: write `<day> <month> <year>` as a bare string instead of `t`, so a language cannot reorder it.
  it("let a language reorder a form without touching the others", async () => {
    vi.resetModules();
    const fresh: typeof dateFormat = await import("./dateFormat.js");
    (globalThis as { LOGJAM_LANGUAGE?: string }).LOGJAM_LANGUAGE = "en-US";
    const day = fresh.dayOfKey("2026-03-15");
    expect(fresh.formatDayMonthYear(day)).toBe("Mar 15, 2026");
    expect(fresh.formatWeekdayDayMonth(day)).toBe("Sun, Mar 15");
    expect(fresh.formatMonthYear(day)).toBe("Mar 2026");
    expect(fresh.formatWeekdayDayMonthYear(day)).toBe("Sun 15 Mar 2026");
  });

  // Mutation: return the pattern as it is when a part is NaN, so "<day> <month>" shows.
  it("read a date that does not exist as 'Invalid date'", () => {
    const nothing = dayOfKey("not-a-date");
    for (const [name, form] of FORMS) {
      expect(form(nothing), name).toBe("Invalid date");
    }
  });
});

describe("the day a Date is", () => {
  // Mutation: read `getUTCDate` in `localDay`.
  it("is its local calendar day for a timestamp", () => {
    // 07:00 on 15 March in Sydney is still 14 March in UTC.
    inTimeZone("Australia/Sydney", () => {
      expect(localDay(new Date("2026-03-14T20:00:00.000Z"))).toEqual({
        year: 2026,
        month: 2,
        day: 15,
        weekday: 0,
      });
    });
  });

  // Mutation: read `getDate` in `utcDay`.
  it("is its UTC calendar day for a date-only value", () => {
    // Midnight UTC is still 14 March in Los Angeles.
    inTimeZone("America/Los_Angeles", () => {
      expect(utcDay(new Date("2026-03-15T00:00:00.000Z"))).toEqual({
        year: 2026,
        month: 2,
        day: 15,
        weekday: 0,
      });
    });
  });

  // Mutation: read `dayOfKey`'s day with `localDay`, and Los Angeles reads the 28th.
  it("is the key's own day, whatever the time zone", () => {
    inTimeZone("America/Los_Angeles", () => {
      expect(dayOfKey("2024-02-29")).toEqual({
        year: 2024,
        month: 1,
        day: 29,
        weekday: 4,
      });
    });
  });
});
