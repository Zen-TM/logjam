import { useId } from "react";
import classes from "./Choice.module.css";
import { Icon } from "./Icon";

/**
 * A checkbox with its label beside it, for an item in a set (which types a
 * field applies to, which layers go in an export). A native checkbox, so Space,
 * forms and assistive tech work as they do everywhere, and the whole line is its
 * target. A setting that takes effect at once is a `SwitchRow` instead.
 */
export function Checkbox({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const descriptionId = useId();
  return (
    <label className={classes.checkbox} data-disabled={disabled || undefined}>
      <span className={classes.box}>
        <input
          type="checkbox"
          className={classes.checkboxInput}
          checked={checked}
          disabled={disabled}
          aria-describedby={description ? descriptionId : undefined}
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
        <span className={classes.title}>{label}</span>
        {description && (
          <span id={descriptionId} className={classes.description}>
            {description}
          </span>
        )}
      </span>
    </label>
  );
}
