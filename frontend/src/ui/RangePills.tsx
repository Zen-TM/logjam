import { useRef, type PointerEvent } from "react";
import { formatRange, isFullRange, nextRange, type NumberRange } from "@logjam/shared";
import { Chip } from "./Chip";
import { FilterField } from "./FilterField";
import classes from "./RangePills.module.css";

/**
 * A small whole-number axis (a grade, a rating) as a row of numbered pills — the
 * same control Logjam GPS uses, and one rule for both clients' taps
 * (`nextRange`): tap to start, tap outside to widen, tap inside to narrow, tap
 * the only value to clear. Dragging across the pills selects the span dragged
 * over; tapping remains the single-pointer way to reach every range a drag can
 * (WCAG 2.5.7). Emits null for "any", which the place filter treats as inactive.
 */
export function RangePills({
  label,
  stops,
  value,
  onChange,
}: {
  label: string;
  /** Every value on the axis, in order (`filterPillStops`). */
  stops: readonly number[];
  value: NumberRange | null;
  onChange: (next: NumberRange | null) => void;
}) {
  const bounds = [stops[0], stops[stops.length - 1]] as const;
  const active = !isFullRange(value, bounds);
  const drag = useRef<{ anchor: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);

  const startDrag = (event: PointerEvent<HTMLButtonElement>, stop: number) => {
    if (event.button !== 0) return;
    // A touch captures its pointer to the pill it started on, so the pills it
    // crosses would never hear it; releasing it gives each one pointerenter.
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drag.current = { anchor: stop, moved: false };
    const end = () => {
      justDragged.current = drag.current?.moved ?? false;
      drag.current = null;
      // The click that follows this pointerup must not toggle a pill as well —
      // and a click that never comes must not swallow the next real one, or
      // the next Enter on a focused pill.
      window.setTimeout(() => {
        justDragged.current = false;
      }, 0);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const extendDrag = (stop: number) => {
    const current = drag.current;
    if (!current || (stop === current.anchor && !current.moved)) return;
    current.moved = true;
    const range: NumberRange = [Math.min(current.anchor, stop), Math.max(current.anchor, stop)];
    if (value && value[0] === range[0] && value[1] === range[1]) return;
    onChange(isFullRange(range, bounds) ? null : range);
  };

  return (
    <FilterField label={label} summary={formatRange(value, bounds)} active={active} onClear={() => onChange(null)}>
      <div className={classes.pills}>
        {stops.map((stop) => {
          const inRange = value !== null && stop >= value[0] && stop <= value[1];
          return (
            <Chip
              key={stop}
              label={String(stop)}
              active={inRange}
              aria-pressed={inRange}
              onPointerDown={(event) => startDrag(event, stop)}
              onPointerEnter={() => extendDrag(stop)}
              onClick={() => {
                if (!justDragged.current) onChange(nextRange(value, stop));
              }}
            />
          );
        })}
      </div>
    </FilterField>
  );
}
