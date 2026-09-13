import { useId } from "react";
import classes from "./Toggle.module.css";

/** An on/off switch. A real `role="switch"` button, so Space and Enter work
 *  and the state is announced. */
export function Toggle({
  checked,
  onChange,
  label,
  labelledBy,
  describedBy,
  small = false,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name when no visible label is associated via `labelledBy`. */
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  small?: boolean;
  disabled?: boolean;
}) {
  if (!label && !labelledBy) throw new Error("Toggle needs a label or labelledBy");
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      className={[classes.toggle, small && classes.small].filter(Boolean).join(" ")}
      onClick={() => onChange(!checked)}
    >
      <span className={classes.thumb} />
    </button>
  );
}

/** A setting: its title and an explanation on the left, the switch on the right.
 *  The title names the switch and the explanation describes it. */
export function SwitchRow({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <div className={classes.row}>
      <div className={classes.text}>
        <span id={titleId} className={classes.title}>
          {title}
        </span>
        {description && (
          <span id={descriptionId} className={classes.description}>
            {description}
          </span>
        )}
      </div>
      <Toggle
        checked={checked}
        onChange={onChange}
        labelledBy={titleId}
        describedBy={description ? descriptionId : undefined}
        disabled={disabled}
      />
    </div>
  );
}
