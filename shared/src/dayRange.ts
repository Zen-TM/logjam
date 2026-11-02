// The tap sequence of the one calendar that picks a date range, for both
// clients' own grids. Days are "YYYY-MM-DD" keys, which sort as dates.
export type DayRange = { start: string | null; end: string | null };

/**
 * The range after a tap on `day`: the first sets the start, a later day ends
 * it, and the start day again, while the range is only that day, leaves a
 * one-day trip (`end` null). A one-day trip is `end` null, never `end` equal
 * to `start`. A day before the
 * start, or any tap on a finished range, starts over: the booking-calendar
 * convention. Guard: dayRange.test.ts.
 */
export function pickDay(range: DayRange, day: string): DayRange {
  const { start, end } = range;
  if (start && !end && day > start) return { start, end: day };
  return { start: day, end: null };
}
