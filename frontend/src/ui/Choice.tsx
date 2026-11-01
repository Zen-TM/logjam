import { useId, type ReactNode } from "react";
import classes from "./Choice.module.css";
import { Icon } from "./Icon";

/**
 * A checkbox with its label beside it, for an item in a set (which types a
 * field applies to, which layers go in an export). A native checkbox, so Space,
 * forms and assistive tech work as they do everywhere, and the whole line is its
 * target. A setting in a panel that takes effect at once is a `SwitchRow`
 * instead.
 *
 * `card` gives it a button's look, for a setting that takes effect at once
 * floating over the map with the buttons beside it, where a `SwitchRow`
 * cannot sit inline and a bare label would sit on the basemap.
 *
 * `labelHasLinks` is for a label with links in it. Nothing interactive goes
 * inside a `<label>` (DESIGN.md), so the line is a plain element that names the
 * input, and its words still tick the box.
 */
export function Checkbox({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  card = false,
  describedBy,
  labelHasLinks = false,
}: {
  label: ReactNode;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  card?: boolean;
  /** Another element that describes it, such as why it is disabled. */
  describedBy?: string;
  labelHasLinks?: boolean;
}) {
  const descriptionId = useId();
  const labelId = useId();
  const Line = labelHasLinks ? "div" : "label";
  return (
    <Line
      className={card ? classes.cardCheckbox : classes.checkbox}
      data-disabled={disabled || undefined}
    >
      <span className={classes.box}>
        <input
          type="checkbox"
          className={classes.checkboxInput}
          checked={checked}
          disabled={disabled}
          aria-labelledby={labelHasLinks ? labelId : undefined}
          aria-describedby={
            [description ? descriptionId : null, describedBy]
              .filter(Boolean)
              .join(" ") || undefined
          }
          onChange={(event) => onChange(event.target.checked)}
        />
        <Icon
          idea="done"
          size={12}
          strokeWidth={3}
          aria-hidden
          className={classes.tick}
        />
      </span>
      <span className={classes.text}>
        {/* A convenience for the pointer: the keyboard has the input itself. */}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <span
          id={labelId}
          className={classes.title}
          onClick={
            labelHasLinks
              ? (event) => {
                  const link = (event.target as HTMLElement).closest("a");
                  if (!link && !disabled) onChange(!checked);
                }
              : undefined
          }
        >
          {label}
        </span>
        {description && (
          <span id={descriptionId} className={classes.description}>
            {description}
          </span>
        )}
      </span>
    </Line>
  );
}
