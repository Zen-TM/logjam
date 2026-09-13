import { useId, type InputHTMLAttributes, type Ref } from "react";
import { Search } from "lucide-react";
import { FieldError } from "../components/feedback/FieldError";
import classes from "./TextField.module.css";

/** A labelled input with its validation message under it. The label is
 *  visible (a placeholder is not a label), and the error is tied to the input
 *  so it is read when the field is focused. */
export function TextField({
  label,
  error,
  id,
  className,
  ref,
  ...inputProps
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string | null;
  ref?: Ref<HTMLInputElement>;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  return (
    <div className={[classes.field, className].filter(Boolean).join(" ")}>
      <label htmlFor={inputId} className={classes.label}>
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        className={classes.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...inputProps}
      />
      <FieldError id={errorId} message={error ?? null} />
    </div>
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
      <Search size={16} aria-hidden className={classes.searchGlyph} />
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
