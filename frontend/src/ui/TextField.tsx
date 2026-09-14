import {
  useId,
  useState,
  type ComponentProps,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
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
