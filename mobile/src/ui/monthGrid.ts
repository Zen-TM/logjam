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

/**
 * The user's own calendar day, as a date key.
 *
 * NOT `toDateKey(new Date())`: that reads the clock in UTC, so east of
 * Greenwich it still says yesterday for the first hours of every local day —
 * someone logging a trip at 00:30 AEST would find today's date greyed out as
 * "the future". A trip date is a calendar day the user was out on, so "today"
 * is their local one; only the STORED instant is UTC midnight of that day.
 */
export function todayDateKey(now: Date = new Date()): string {
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** UTC midnight of a "YYYY-MM-DD" key — the instant the API stores. */
export function fromDateKey(key: string): Date {
  const date = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Not a date key: "${key}"`);
  return date;
}

export type YearMonth = { year: number; month: number };

/** Rows in every month grid — the worst case, so the grid never resizes. */
export const WEEKS_SHOWN = 6;

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
 * with nulls to a FIXED six rows.
 *
 * Six rather than "however many this month needs": a month grid that changes
 * height changes the height of the sheet containing it, so paging through
 * months would make the whole panel jump. Six is the maximum any month
 * requires (31 days starting on a Sunday), so every month fits without ever
 * resizing.
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
  while (cells.length < WEEKS_SHOWN * 7) cells.push(null);
  return cells;
}

/**
 * First year of the fixed block a year belongs to — blocks END on a multiple of
 * `size` (with size 20: 1981-2000, 2001-2020, 2021-2040).
 *
 * Fixed rather than centred on the selection: a grid whose contents shift with
 * what is selected puts the same year in a different place every time it opens,
 * so the user can never learn where anything is.
 */
export function yearBlockStart(year: number, size: number): number {
  return Math.ceil(year / size) * size - (size - 1);
}

export const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"] as const;

export function formatMonthLabel({ year, month }: YearMonth): string {
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
