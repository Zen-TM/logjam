// The calendar's pure rules. Days are "YYYY-MM-DD" keys read in UTC, as a
// plan's dates are stored, so no time zone moves a day.
import type { DayRange } from "@logjam/shared";

export type DateRange = DayRange;

/** The first of a month, Monday-first, padded to six weeks of day keys (null
 *  outside the month) so paging never changes the calendar's height. */
export function monthGrid(year: number, month: number): (string | null)[] {
  const lead = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d += 1)
    cells.push(new Date(Date.UTC(year, month, d)).toISOString().slice(0, 10));
  while (cells.length < 42) cells.push(null);
  return cells;
}

export function inRange(range: DateRange, day: string): boolean {
  const { start, end } = range;
  return start != null && day >= start && day <= (end ?? start);
}
