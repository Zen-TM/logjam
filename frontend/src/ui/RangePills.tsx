import { useId } from "react";
import { X } from "lucide-react";
import { formatRange, isFullRange, nextRange, type NumberRange } from "@logjam/shared";
import { IconButton } from "./Button";
import { Chip } from "./Chip";
import classes from "./RangePills.module.css";

/**
 * A small whole-number axis (a grade, a rating) as a row of numbered pills — the
 * same control Logjam GPS uses, and one rule for both (`nextRange`): tap to
 * start, tap outside to widen, tap inside to narrow, tap the only value to
 * clear. Emits null for "any", which the place filter treats as inactive.
 */
export function RangePills({
  label,
  bounds,
  value,
  prefix = "",
  onChange,
}: {
  label: string;
  bounds: readonly [number, number];
  value: NumberRange | null;
  /** Before each number in the summary ("V3–V5"), not on the pills. */
  prefix?: string;
  onChange: (next: NumberRange | null) => void;
}) {
  const labelId = useId();
  const [min, max] = bounds;
  const stops: number[] = [];
  for (let stop = min; stop <= max; stop += 1) stops.push(stop);
  const active = !isFullRange(value, bounds);

  return (
    <div role="group" aria-labelledby={labelId} className={classes.wrap}>
      <div className={classes.header}>
        <span id={labelId} className={classes.label}>
          {label}
        </span>
        <span className={classes.value} data-active={active}>
          {formatRange(value, bounds, prefix)}
        </span>
        {active && (
          <IconButton icon={X} size={16} label={`Clear the ${label} filter`} onClick={() => onChange(null)} />
        )}
      </div>
      <div className={classes.pills}>
        {stops.map((stop) => (
          <Chip
            key={stop}
            label={String(stop)}
            active={value !== null && stop >= value[0] && stop <= value[1]}
            aria-pressed={value !== null && stop >= value[0] && stop <= value[1]}
            onClick={() => onChange(nextRange(value, stop))}
          />
        ))}
      </div>
    </div>
  );
}
