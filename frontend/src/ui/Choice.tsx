import { useId, type CSSProperties } from "react";
import { Check } from "lucide-react";
import classes from "./Choice.module.css";

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
        <Check size={12} strokeWidth={3} aria-hidden className={classes.tick} />
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

/**
 * A colour from a closed list (a route's colour). Native radios, so the group
 * is one tab stop and the arrow keys move the choice. The colour IS the data,
 * so it rides in as `--swatch` rather than a token. The chosen swatch wears an
 * accent ring, which is measured against the page; the swatches themselves
 * cannot be, for every colour the list offers.
 */
export function SwatchPicker({
  label,
  colors,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  colors: readonly string[];
  value: string | undefined;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className={classes.swatches} disabled={disabled}>
      <legend className={classes.legend}>{label}</legend>
      <div className={classes.swatchRow}>
        {colors.map((color) => (
          <input
            key={color}
            type="radio"
            name={name}
            value={color}
            checked={color === value}
            onChange={() => onChange(color)}
            aria-label={color}
            title={color}
            className={classes.swatch}
            style={{ "--swatch": color } as CSSProperties}
          />
        ))}
      </div>
    </fieldset>
  );
}
