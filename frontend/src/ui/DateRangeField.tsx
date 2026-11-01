import { useState } from "react";
import { pickDay, todayDateKey, tripPlanDatesLabel } from "@logjam/shared";
import { Button, IconButton } from "./Button";
import { inRange, monthGrid } from "./dateRange";
import classes from "./DateRangeField.module.css";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * A date range in one calendar: the first click is the start, a later day the
 * end, and a one-day trip is the start alone (`end` null). A day before the
 * start starts over. Days are "YYYY-MM-DD". The words come in as `labels`, so
 * the kit holds none of a page's copy.
 */
export function DateRangeField({
  label,
  start,
  end,
  onChange,
  hint,
  labels,
}: {
  label: string;
  start: string | null;
  end: string | null;
  onChange: (start: string | null, end: string | null) => void;
  hint?: string;
  labels: { none: string; clear: string; prevMonth: string; nextMonth: string };
}) {
  const first = start ?? todayDateKey();
  const [shown, setShown] = useState({
    year: Number(first.slice(0, 4)),
    month: Number(first.slice(5, 7)) - 1,
  });
  const range = { start, end };

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
      <div className={classes.grid}>
        {WEEKDAYS.map((day, i) => (
          <span key={i} className={classes.weekday} aria-hidden>
            {day}
          </span>
        ))}
        {monthGrid(shown.year, shown.month).map((day, i) => {
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
              ]
                .filter(Boolean)
                .join(" ")}
              aria-pressed={inRange(range, day)}
              aria-current={day === todayDateKey() ? "date" : undefined}
              aria-label={new Date(`${day}T00:00:00Z`).toLocaleDateString(
                undefined,
                { dateStyle: "full", timeZone: "UTC" },
              )}
              onClick={() => pick(day)}
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
      {hint && <p className={classes.summary}>{hint}</p>}
    </fieldset>
  );
}
