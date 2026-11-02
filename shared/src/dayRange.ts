// The tap sequence of the one calendar that picks a date range, for both
// clients' own grids. Days are "YYYY-MM-DD" keys, which sort as dates.
export type DayRange = { start: string | null; end: string | null };

/**
 * The range after a tap on `day`: the first sets the start, a later day ends
 * it, and the start day again, while the range is only that day, leaves a
 * one-day trip (`end` null). A day before the start, or any tap on a finished
 * range, starts over: the booking-calendar convention. One tap is enough: Done
 * saves it through `settleDayRange`. Guard: dayRange.test.ts.
 */
export function pickDay(range: DayRange, day: string): DayRange {
  const { start, end } = range;
  if (start && !end && day > start) return { start, end: day };
  return { start: day, end: null };
}

/** What Done saves: a start alone is a one-day trip, so its end is the start. */
export function settleDayRange(range: DayRange): DayRange {
  return range.start && !range.end
    ? { start: range.start, end: range.start }
    : range;
}

/** One day's place in the highlight band of a week row. */
export type BandCell = {
  /** Leftmost day of this row's piece of the band: its left end is rounded. */
  pieceStart: boolean;
  /** Rightmost day of this row's piece: its right end is rounded. */
  pieceEnd: boolean;
  /** The range's first day: the band begins at its centre, under the fill. */
  isStart: boolean;
  /** The range's last day: the band ends at its centre, under the fill. */
  isEnd: boolean;
};

/**
 * The band behind a range, one row of seven cells at a time (`null` is a
 * blank cell). A continuous band covers the days from start to end,
 * including both; each row's piece is rounded at its own ends, so a range
 * that crosses a week shows rounded ends at the row edges. A one-day range
 * has no band, only the selected mark. Both clients draw from this. Guard:
 * dayRange.test.ts.
 */
export function weekBand(
  range: DayRange,
  week: readonly (string | null)[],
): (BandCell | null)[] {
  const { start, end } = range;
  const inBand = (day: string | null) =>
    day != null &&
    start != null &&
    end != null &&
    end > start &&
    day >= start &&
    day <= end;
  return week.map((day, i) =>
    inBand(day)
      ? {
          pieceStart: !inBand(week[i - 1] ?? null),
          pieceEnd: !inBand(week[i + 1] ?? null),
          isStart: day === start,
          isEnd: day === end,
        }
      : null,
  );
}
