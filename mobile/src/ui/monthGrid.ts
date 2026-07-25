/**
 * Pure calendar math for `DatePicker`. Kept RN-free so it is unit-testable.
 *
 * Everything is UTC. Trip dates are stored as UTC-midnight date-only values
 * (CH-001), so a picker that built its grid in local time would hand back the
 * previous day for every AEST user.
 */

/** "YYYY-MM-DD" for a Date, read in UTC. */
export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** UTC midnight of a "YYYY-MM-DD" key — the instant the API stores. */
export function fromDateKey(key: string): Date {
  const date = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Not a date key: "${key}"`);
  return date;
}

export type YearMonth = { year: number; month: number };

/** `month` is 0-indexed, matching Date. Wraps across year boundaries. */
export function addMonths({ year, month }: YearMonth, delta: number): YearMonth {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

export function monthOf(key: string): YearMonth {
  const date = fromDateKey(key);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

/**
 * Week-aligned day keys for one month, Monday-first (AU convention), padded
 * with nulls so every row is a full week of seven cells.
 */
export function monthGrid({ year, month }: YearMonth): (string | null)[] {
  const first = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  // getUTCDay is Sunday-0; shift so Monday is 0.
  const leading = (first.getUTCDay() + 6) % 7;

  const cells: (string | null)[] = new Array(leading).fill(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(toDateKey(new Date(Date.UTC(year, month, day))));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"] as const;

export function formatMonthLabel({ year, month }: YearMonth): string {
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
