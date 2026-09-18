import {
  useEffect,
  useId,
  useState,
  type ComponentProps,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { ChevronDown, Search } from "lucide-react";
import { FieldError } from "../components/feedback/FieldError";
import { numericFieldError, sanitizeDecimalInput, type NumericFieldConstraints } from "../numberInput";
import classes from "./TextField.module.css";

type FieldLabelling = {
  label: string;
  hideLabel?: boolean;
  /** A line under the control saying what it means or what it takes. Visible,
   *  and read with the control, where a tooltip would be neither. */
  hint?: string;
  error?: string | null;
};

/** The anatomy every labelled control shares: label, control, hint, error. */
function Field({
  inputId,
  label,
  hideLabel = false,
  hint,
  error,
  className,
  children,
}: FieldLabelling & { inputId: string; className?: string; children: ReactNode }) {
  return (
    <div className={[classes.field, className].filter(Boolean).join(" ")}>
      <label htmlFor={inputId} className={hideLabel ? "visually-hidden" : classes.label}>
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${inputId}-hint`} className={classes.hint}>
          {hint}
        </p>
      )}
      <FieldError id={`${inputId}-error`} message={error ?? null} />
    </div>
  );
}

const describedBy = (inputId: string, hint?: string, error?: string | null) =>
  [hint && `${inputId}-hint`, error && `${inputId}-error`].filter(Boolean).join(" ") || undefined;

/** A labelled input with its validation message under it. The label is
 *  visible (a placeholder is not a label), and the error is tied to the input
 *  so it is read when the field is focused. `hideLabel` is only for a field
 *  whose meaning the control right above it already shows (the number after
 *  Under / Over / Exactly); the label is still its accessible name. A date is
 *  `type="date"`: the native picker follows the page's dark `color-scheme`. */
export function TextField({
  label,
  hideLabel,
  hint,
  error,
  id,
  className,
  ref,
  ...inputProps
}: InputHTMLAttributes<HTMLInputElement> & FieldLabelling & { ref?: Ref<HTMLInputElement> }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <Field inputId={inputId} label={label} hideLabel={hideLabel} hint={hint} error={error} className={className}>
      <input
        ref={ref}
        id={inputId}
        className={classes.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, hint, error)}
        {...inputProps}
      />
    </Field>
  );
}

/**
 * A number typed as text: no spin buttons, and every keystroke passes through
 * `sanitizeDecimalInput`, so letters never land. An integer field keeps the
 * decimal point, so "5.5" is reported ("Whole numbers only") rather than
 * silently becoming 55. The error shows once the field has been left, or at
 * once while `showError` is set (a Save attempt lights every bad field).
 *
 * The caller blocks its save with the same `numericFieldError` and the same
 * constraints; validity is never hidden in this component. `""` is unset, and
 * whether unset is allowed is the caller's decision.
 */
export function NumberField({
  value,
  onChange,
  constraints,
  showError = false,
  onBlur,
  ...fieldProps
}: Omit<ComponentProps<typeof TextField>, "value" | "onChange" | "type" | "inputMode" | "error"> & {
  value: string;
  onChange: (next: string) => void;
  constraints: NumericFieldConstraints;
  showError?: boolean;
}) {
  const [touched, setTouched] = useState(false);
  const error = numericFieldError(value, constraints);
  return (
    <TextField
      {...fieldProps}
      type="text"
      inputMode={constraints.integer ? "numeric" : "decimal"}
      value={value}
      onChange={(event) => onChange(sanitizeDecimalInput(event.target.value))}
      onBlur={(event) => {
        setTouched(true);
        onBlur?.(event);
      }}
      error={touched || showError ? error : null}
    />
  );
}

/**
 * A number that is ALREADY IN FORCE while it is being typed: a topo's contour
 * width, a hillshade angle, a slope band's boundary. The value in the model is
 * a number rather than a string, and this holds the typing.
 *
 * Every valid keystroke commits, so the map (or the band below) follows the
 * digit as it lands; a half-typed "1.", an empty box or an out-of-range number
 * stays here and is reported under the field rather than reaching a live
 * renderer or the server's range check. Leaving the field puts back the value
 * in force. A value changed elsewhere — a template applied, a neighbouring
 * boundary pushed — replaces the draft, unless the draft already MEANS that
 * number, so "45." is not rewritten under the cursor.
 *
 * It was written three times over (the style sheet's widths, the hillshade
 * angles, the slope boundaries) before it came here.
 */
export function LiveNumberField({
  value,
  onCommit,
  constraints,
  ...fieldProps
}: Omit<ComponentProps<typeof NumberField>, "value" | "onChange"> & {
  value: number;
  onCommit: (next: number) => void;
  constraints: NumericFieldConstraints;
}) {
  const [draft, setDraft] = useState(() => String(value));
  useEffect(() => {
    setDraft((current) => (current.trim() !== "" && Number(current) === value ? current : String(value)));
  }, [value]);

  return (
    <NumberField
      {...fieldProps}
      value={draft}
      constraints={constraints}
      onChange={(next) => {
        setDraft(next);
        if (next.trim() !== "" && numericFieldError(next, constraints) === null) onCommit(Number(next));
      }}
      // Whatever is left that never committed (empty, "-", out of range) is
      // not a value: the field goes back to what is drawn.
      onBlur={() => setDraft(String(value))}
    />
  );
}

/** Several lines of text (notes). It rests at `minRows`, grows with what is
 *  typed and stops at `maxRows`, where it scrolls: a fixed height would nest a
 *  scrollbar inside the dialog's own. */
export function TextArea({
  label,
  hideLabel,
  hint,
  error,
  id,
  className,
  minRows = 4,
  maxRows = 12,
  style,
  ref,
  ...textareaProps
}: TextareaHTMLAttributes<HTMLTextAreaElement> &
  FieldLabelling & { minRows?: number; maxRows?: number; ref?: Ref<HTMLTextAreaElement> }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <Field inputId={inputId} label={label} hideLabel={hideLabel} hint={hint} error={error} className={className}>
      <textarea
        ref={ref}
        id={inputId}
        rows={minRows}
        className={`${classes.input} ${classes.textarea}`}
        style={{ ...style, "--min-rows": minRows, "--max-rows": maxRows } as CSSProperties}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, hint, error)}
        {...textareaProps}
      />
    </Field>
  );
}

/** A native `<select>` in the field's clothes. Native, so the platform's own
 *  list, keyboard and type-to-find come free. The options are the caller's
 *  `<option>` children. */
export function Select({
  label,
  hideLabel,
  hint,
  error,
  id,
  className,
  ref,
  children,
  ...selectProps
}: SelectHTMLAttributes<HTMLSelectElement> & FieldLabelling & { ref?: Ref<HTMLSelectElement> }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <Field inputId={inputId} label={label} hideLabel={hideLabel} hint={hint} error={error} className={className}>
      <div className={classes.selectBox}>
        <select
          ref={ref}
          id={inputId}
          className={`${classes.input} ${classes.select}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(inputId, hint, error)}
          {...selectProps}
        >
          {children}
        </select>
        <ChevronDown size={16} aria-hidden className={classes.selectGlyph} />
      </div>
    </Field>
  );
}

/** A search box: a pill with the glyph inside. `label` is its accessible name
 *  and, unless one is given, its placeholder. */
export function SearchField({
  label,
  className,
  placeholder,
  ref,
  ...inputProps
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
  ref?: Ref<HTMLInputElement>;
}) {
  return (
    <div className={[classes.search, className].filter(Boolean).join(" ")}>
      <Search size={14} aria-hidden className={classes.searchGlyph} />
      <input
        ref={ref}
        type="search"
        aria-label={label}
        placeholder={placeholder ?? label}
        className={classes.searchInput}
        {...inputProps}
      />
    </div>
  );
}


/**
 * A bounded number chosen by feel: a native range input with its ENDS and its
 * reading written out — "0.5×" and "2×" flanking the track, the value itself at
 * the end of the label line.
 *
 * It is the kit's only slider, and it earns that by being the only value of its
 * kind: bounded on both sides, continuous, with no unit of its own and nothing
 * to compare it against except the map it is redrawing. A box to type in was
 * tried and put back (operator, 2026-09-18) — it asked for a precision nobody
 * has, and it showed neither the bounds nor that the number is a multiplier.
 * Native, so the arrows, Home/End and the announcement are the platform's.
 */
export function RangeField({
  label,
  min,
  max,
  id,
  className,
  value,
  format,
  onChange,
  ...inputProps
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "min" | "max"> & {
  label: string;
  min: number;
  max: number;
  value: number;
  /** What the value reads as, at the ends and to assistive tech ("1.2×"). */
  format: (value: number) => string;
  onChange: (next: number) => void;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  // The filled part of the track, as the fraction the thumb sits at.
  const fill = `${((value - min) / (max - min)) * 100}%`;
  return (
    <div className={[classes.rangeField, className].filter(Boolean).join(" ")}>
      <div className={classes.rangeHead}>
        <label htmlFor={inputId} className={classes.label}>
          {label}
        </label>
        <output htmlFor={inputId} className={classes.rangeValue}>
          {format(value)}
        </output>
      </div>
      <div className={classes.range}>
        <span className={classes.rangeEnd} aria-hidden>
          {format(min)}
        </span>
        <input
          id={inputId}
          type="range"
          className={classes.rangeInput}
          min={min}
          max={max}
          value={value}
          style={{ "--fill": fill } as CSSProperties}
          aria-valuetext={format(value)}
          onChange={(event) => onChange(Number(event.target.value))}
          {...inputProps}
        />
        <span className={classes.rangeEnd} aria-hidden>
          {format(max)}
        </span>
      </div>
    </div>
  );
}
