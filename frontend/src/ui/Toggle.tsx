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
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name when no visible label is associated via `labelledBy`. */
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  disabled?: boolean;
}) {
  if (!label && !labelledBy)
    throw new Error("Toggle needs a label or labelledBy");
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      className={classes.toggle}
      onClick={() => onChange(!checked)}
    >
      <span className={classes.thumb} />
    </button>
  );
}

/**
 * A setting: its title and an explanation on the left, the switch on the right.
 * The WHOLE row is the switch's target (UX §4: a thing that does something on
 * press looks pressable), so it wears the card fill and answers the pointer. The
 * switch inside stays the one real control: one `role="switch"` named by the
 * title and described by the explanation, which is also the keyboard path. A
 * press on the rest of the row flips it too.
 *
 * `disabled` dims it and stops it answering; `description` then carries the
 * reason ("Needs an account"), which the switch reads out as its description.
 */
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
    // The click is a convenience over the switch's own button, which already
    // takes Space and Enter: a second tab stop here would announce it twice.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className={classes.row}
      data-disabled={disabled || undefined}
      onClick={(event) => {
        if (disabled) return;
        if ((event.target as HTMLElement).closest('[role="switch"]')) return;
        onChange(!checked);
      }}
    >
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
