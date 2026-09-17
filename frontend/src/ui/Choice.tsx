import { useId, useRef, useState, type CSSProperties } from "react";
import { Check } from "lucide-react";
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
 * A colour from a closed list (a route's colour).
 *
 * THE FIELD IS NOT THE BUTTON. It reads as a row — its label at the left, what
 * it is set to beside it, and the colour itself as a square filling the row's
 * full height at the right. Only that square is the control: a card where the
 * whole surface was clickable gave a 380px panel a large target whose job was
 * to show one small colour, and the colour is the part anyone aims at
 * (operator, 2026-09-17).
 *
 * The NAME stays visible next to the swatch rather than being folded into the
 * accessible name. It is the only part of this control that survives being
 * unable to tell the colours apart, which is exactly the user this field is
 * hardest for.
 *
 * The palette keeps its native radios, so the group is one tab stop and the
 * arrow keys move the choice; the popover only changes where they are. It is
 * laid out three to a row — taller than it is wide — because a single flat row
 * of ten spent the width of the panel showing nine colours nobody picked.
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
      <span className={classes.swatchLabel}>{label}</span>
      {/* The swatch IS the control, and it is the whole of it. No caret, no
          card behind the row, and no colour NAME: the swatch shows the colour,
          so spelling it out beside it says the same thing twice (operator,
          2026-09-17). The name is still the control's accessible name, where it
          is the only thing a reader who cannot see the swatch has. */}
      <button
        ref={triggerRef}
        type="button"
        className={classes.swatchTrigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${chosen}`}
        title={chosen}
        disabled={disabled}
        style={{ "--swatch": value } as CSSProperties}
        onClick={() => setOpen((current) => !current)}
      />

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        label={label}
        placement="bottom-end"
        className={classes.swatchPopover}
      >
        <fieldset className={classes.swatches}>
          <legend className={classes.legend}>{label}</legend>
          <div className={classes.swatchGrid}>
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
