import classes from "./Scrubber.module.css";

/**
 * A bounded run of whole steps dragged through, over the map (the weather
 * bar): a native range, so arrows, Home and End work and a screen reader hears
 * `valueText` as its value. The same component as Logjam GPS's `Scrubber`.
 */
export function Scrubber({
  first,
  last,
  value,
  onChange,
  label,
  valueText,
}: {
  first: number;
  last: number;
  value: number;
  onChange: (next: number) => void;
  /** The accessible name. */
  label: string;
  /** What the step reads as, spoken in place of its number. */
  valueText: string;
}) {
  return (
    <input
      type="range"
      className={classes.scrubber}
      aria-label={label}
      aria-valuetext={valueText}
      min={first}
      max={last}
      step={1}
      value={value}
      onChange={(e) => onChange(Number(e.currentTarget.value))}
    />
  );
}
