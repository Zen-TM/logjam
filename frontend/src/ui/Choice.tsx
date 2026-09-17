import { useId, useRef, useState, type CSSProperties } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover } from "./Menu";
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
  nameOf,
  disabled = false,
}: {
  label: string;
  colors: readonly string[];
  value: string | undefined;
  onChange: (next: string) => void;
  /** What to CALL each colour, as its accessible name and its tooltip. Without
   *  one a swatch answers to its hex, which is a name but not a helpful one —
   *  unreadable aloud, and ten of them in a row. `trackColorName` is the one
   *  for the route palette. */
  nameOf?: (color: string) => string;
  disabled?: boolean;
}) {
  const name = useId();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const chosen = value ? (nameOf?.(value) ?? value) : "No colour";

  return (
    <div className={classes.swatchField}>
      {/* The CHOICE, not the palette. Ten swatches laid out flat spent a whole
          block of a 380px panel showing nine colours nobody picked; the field
          now reads like every other one — its label, then what it is set to
          (operator, 2026-09-17). */}
      <button
        ref={triggerRef}
        type="button"
        className={classes.swatchTrigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${chosen}`}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={classes.swatchDot} style={{ "--swatch": value } as CSSProperties} />
        <span className={classes.swatchText}>
          <span className={classes.legend}>{label}</span>
          <span className={classes.swatchValue}>{chosen}</span>
        </span>
        <ChevronDown size={16} aria-hidden />
      </button>

      {/* The palette keeps its fieldset and its native radios, so it is still
          one tab stop with the arrow keys moving the choice — the popover only
          changes WHERE they are, never how they work. */}
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        label={label}
        placement="bottom-start"
        className={classes.swatchPopover}
      >
        <fieldset className={classes.swatches}>
          <legend className={classes.legend}>{label}</legend>
          <div className={classes.swatchRow}>
            {colors.map((color) => (
              <input
                key={color}
                type="radio"
                name={name}
                value={color}
                checked={color === value}
                onChange={() => {
                  onChange(color);
                  // Picking IS the answer to the question the popover asked.
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                aria-label={nameOf?.(color) ?? color}
                title={nameOf?.(color) ?? color}
                className={classes.swatch}
                style={{ "--swatch": color } as CSSProperties}
              />
            ))}
          </div>
        </fieldset>
      </Popover>
    </div>
  );
}
