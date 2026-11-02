import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { pickDay, todayDateKey, tripPlanDatesLabel } from "@logjam/shared";
import { Button, IconButton } from "./Button";
import { inRange, monthGrid } from "./dateRange";
import classes from "./DateRangeField.module.css";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

const addDays = (day: string, by: number) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + by);
  return date.toISOString().slice(0, 10);
};
const KEY_STEP: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

/**
 * A date range in one calendar: the first click is the start, a later day the
 * end, and a one-day trip is the start alone (`end` null). A day before the
 * start starts over. Days are "YYYY-MM-DD". The grid is one tab stop: arrows
 * move by a day or a week (into the next month too), Home and End to the
 * month's ends, PageUp and PageDown by a month. The words come in as `labels`, so
 * the kit holds none of a page's copy.
 */
export function DateRangeField({
  label,
  start,
  end,
  onChange,
  hint,
  tapHint,
  labels,
}: {
  label: string;
  start: string | null;
  end: string | null;
  onChange: (start: string | null, end: string | null) => void;
  hint?: string;
  /** How to get a one-day trip back: shown under the calendar. */
  tapHint?: string;
  labels: { none: string; clear: string; prevMonth: string; nextMonth: string };
}) {
  const first = start ?? todayDateKey();
  const [shown, setShown] = useState({
    year: Number(first.slice(0, 4)),
    month: Number(first.slice(5, 7)) - 1,
  });
  // A start that moved from outside (a 409 adopting the plan's dates) brings
  // its month into view.
  const [seenStart, setSeenStart] = useState(start);
  if (start !== seenStart) {
    setSeenStart(start);
    if (start)
      setShown({
        year: Number(start.slice(0, 4)),
        month: Number(start.slice(5, 7)) - 1,
      });
  }
  const range = { start, end };
  const today = todayDateKey();
  const days = monthGrid(shown.year, shown.month);
  // The one day in the tab order, and the one the arrow keys move from.
  const [active, setActive] = useState<string | null>(null);
  const stop =
    [active, start, today].find((day) => day && days.includes(day)) ??
    days.find(Boolean) ??
    null;
  const gridRef = useRef<HTMLDivElement>(null);
  const focusAfterRender = useRef(false);
  useEffect(() => {
    if (!focusAfterRender.current) return;
    focusAfterRender.current = false;
    gridRef.current
      ?.querySelector<HTMLElement>(`[data-day="${stop}"]`)
      ?.focus();
  });
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!stop) return;
    const monthOf = (day: string) => ({
      year: Number(day.slice(0, 4)),
      month: Number(day.slice(5, 7)) - 1,
    });
    let to: string | null = null;
    if (event.key in KEY_STEP) to = addDays(stop, KEY_STEP[event.key]!);
    else if (event.key === "Home") to = days.find(Boolean) ?? null;
    else if (event.key === "End")
      to = [...days].reverse().find(Boolean) ?? null;
    else if (event.key === "PageUp" || event.key === "PageDown") {
      const { year, month } = monthOf(stop);
      const total = year * 12 + month + (event.key === "PageUp" ? -1 : 1);
      const target = monthGrid(
        Math.floor(total / 12),
        ((total % 12) + 12) % 12,
      );
      const column = Number(stop.slice(8)) - 1;
      to =
        target.filter(Boolean)[column] ?? [...target].reverse().find(Boolean)!;
    }
    if (!to) return;
    event.preventDefault();
    focusAfterRender.current = true;
    setActive(to);
    setShown(monthOf(to));
  };

  const page = (delta: number) =>
    setShown(({ year, month }) => {
      const total = year * 12 + month + delta;
      return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
    });
  const pick = (day: string) => {
    const next = pickDay(range, day);
    onChange(next.start, next.end);
  };
  const monthLabel = new Date(
    Date.UTC(shown.year, shown.month, 1),
  ).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <fieldset className={classes.field}>
      <legend className={classes.label}>{label}</legend>
      <p className={classes.summary}>
        {start ? tripPlanDatesLabel(start, end) : labels.none}
      </p>
      <div className={classes.head}>
        <IconButton
          icon="back"
          label={labels.prevMonth}
          onClick={() => page(-1)}
        />
        <span className={classes.month} aria-live="polite">
          {monthLabel}
        </span>
        <IconButton
          icon="forward"
          label={labels.nextMonth}
          onClick={() => page(1)}
        />
      </div>
      {/* The day buttons are the targets; this only catches their arrow keys. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        className={classes.grid}
        ref={gridRef}
        role="group"
        aria-label={monthLabel}
        onKeyDown={move}
      >
        {WEEKDAYS.map((day, i) => (
          <span key={i} className={classes.weekday} aria-hidden>
            {day}
          </span>
        ))}
        {days.map((day, i) => {
          if (!day) return <span key={i} className={classes.blank} />;
          const edge = day === start || day === (end ?? start);
          return (
            <button
              key={day}
              type="button"
              className={[
                classes.cell,
                inRange(range, day) && classes.inRange,
                edge && classes.end,
                day === today && classes.today,
              ]
                .filter(Boolean)
                .join(" ")}
              data-day={day}
              tabIndex={day === stop ? 0 : -1}
              aria-pressed={inRange(range, day)}
              aria-current={day === today ? "date" : undefined}
              aria-label={new Date(`${day}T00:00:00Z`).toLocaleDateString(
                undefined,
                { dateStyle: "full", timeZone: "UTC" },
              )}
              onClick={() => {
                setActive(day);
                pick(day);
              }}
            >
              {Number(day.slice(8))}
            </button>
          );
        })}
      </div>
      <div className={classes.actions}>
        {start && (
          <Button onClick={() => onChange(null, null)}>{labels.clear}</Button>
        )}
      </div>
      {tapHint && <p className={classes.summary}>{tapHint}</p>}
      {hint && <p className={classes.summary}>{hint}</p>}
    </fieldset>
  );
}
