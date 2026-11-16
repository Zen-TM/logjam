// Every date a user reads is written here, so a language can put the day, the
// month and the year in its own order. Each form is one message whose English
// is a pattern, `<weekday> <day> <month>`, and a translation reorders or
// re-punctuates it (`<weekday>, <month> <day>`). The patterns are written with
// names, not `{0}` holes, because two forms with the same holes would share a
// catalogue key and could not be ordered apart: "Sat 8 Nov" and "15 Mar 2026"
// are both `{0} {1} {2}`. `dateFormat.test.ts` ("give every form a message of
// its own") holds that.
import {
  longMonth,
  longWeekday,
  shortMonth,
  shortWeekday,
} from "./dateNames.js";
import { t } from "./i18n.js";

/** A calendar day, counted the way `Date` counts: `month` from 0, `weekday` from Sunday. */
export type Day = {
  year: number;
  month: number;
  day: number;
  weekday: number;
};

/** The day on the device's calendar: for a true timestamp. */
export function localDay(date: Date): Day {
  return {
    year: date.getFullYear(),
    month: date.getMonth(),
    day: date.getDate(),
    weekday: date.getDay(),
  };
}

/** The day in UTC: for a date-only value, which no time zone may move. */
export function utcDay(date: Date): Day {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
  };
}

/** A `YYYY-MM-DD` key as the calendar day it names. */
export function dayOfKey(key: string): Day {
  const [year, month, day] = key.split("-").map(Number);
  return utcDay(new Date(Date.UTC(year, month - 1, day)));
}

const two = (n: number) => String(n).padStart(2, "0");

const PART: Record<string, (d: Day) => string | number> = {
  weekday: (d) => shortWeekday(d.weekday),
  fullweekday: (d) => longWeekday(d.weekday),
  day: (d) => d.day,
  day2: (d) => two(d.day),
  month: (d) => shortMonth(d.month),
  fullmonth: (d) => longMonth(d.month),
  month2: (d) => two(d.month + 1),
  year: (d) => d.year,
};

/** `pattern` (already looked up) with each `<name>` replaced by that part of `day`. */
function fill(pattern: string, day: Partial<Day>): string {
  // What `toLocaleDateString` writes for a date that does not exist.
  if (Object.values(day).some(Number.isNaN)) return t`Invalid date`;
  return pattern.replace(/<([a-z0-9]+)>/g, (whole, name) =>
    String(PART[name]?.(day as Day) ?? whole),
  );
}

/** "Sun 15 Mar 2026" */
export const formatWeekdayDayMonthYear = (d: Day): string =>
  fill(t`<weekday> <day> <month> <year>`, d);

/** "Sat 8 Nov" */
export const formatWeekdayDayMonth = (
  d: Pick<Day, "weekday" | "day" | "month">,
): string => fill(t`<weekday> <day> <month>`, d);

/** "Sat 8" */
export const formatWeekdayDay = (d: Pick<Day, "weekday" | "day">): string =>
  fill(t`<weekday> <day>`, d);

/** "15 Mar 2026" */
export const formatDayMonthYear = (
  d: Pick<Day, "day" | "month" | "year">,
): string => fill(t`<day> <month> <year>`, d);

/** "15 Mar" */
export const formatDayMonth = (d: Pick<Day, "day" | "month">): string =>
  fill(t`<day> <month>`, d);

/** "Mar 2026" */
export const formatMonthYear = (d: Pick<Day, "month" | "year">): string =>
  fill(t`<month> <year>`, d);

/** "28 September" */
export const formatDayLongMonth = (d: Pick<Day, "day" | "month">): string =>
  fill(t`<day> <fullmonth>`, d);

/** "15 March 2026" */
export const formatDayLongMonthYear = (
  d: Pick<Day, "day" | "month" | "year">,
): string => fill(t`<day> <fullmonth> <year>`, d);

/** "March 2026" */
export const formatLongMonthYear = (d: Pick<Day, "month" | "year">): string =>
  fill(t`<fullmonth> <year>`, d);

/** "Sunday 15 March 2026" */
export const formatFullDay = (d: Day): string =>
  fill(t`<fullweekday> <day> <fullmonth> <year>`, d);

/** "15/03/2026": for where a month's name would not fit. */
export const formatNumericDay = (
  d: Pick<Day, "day" | "month" | "year">,
): string => fill(t`<day2>/<month2>/<year>`, d);
