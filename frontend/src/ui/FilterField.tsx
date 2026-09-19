import { useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "./Button";
import classes from "./FilterField.module.css";

/**
 * One filter in a sheet: its label, what it is set to, a clear button while it
 * is set, then its control. Every kind of filter wears it — pills, number
 * boxes, yes/no, text, dates — so they share one label style and one way to
 * clear, whatever control sits underneath. The header keeps the clear button's
 * height when it is absent, so setting a filter moves nothing below it.
 */
export function FilterField({
  label,
  summary,
  active,
  onClear,
  children,
}: {
  label: string;
  /** What the filter is set to, in words ("Any", "3–5", "Yes"). */
  summary: string;
  active: boolean;
  onClear: () => void;
  children: ReactNode;
}) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className={classes.wrap}>
      <div className={classes.header}>
        <span id={labelId} className={classes.label}>
          {label}
        </span>
        <span className={classes.summary} data-active={active}>
          {summary}
        </span>
        {active && <IconButton icon={X} size={16} label={`Clear the ${label} filter`} onClick={onClear} />}
      </div>
      {children}
    </div>
  );
}
