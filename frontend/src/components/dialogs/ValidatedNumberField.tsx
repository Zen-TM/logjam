import { useState } from "react";
import type { ReactNode } from "react";
import { TextField, InputAdornment, Tooltip } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { FieldError } from "../feedback/FieldError";
import {
  sanitizeDecimalInput,
  numericFieldError,
  type NumericFieldConstraints,
} from "../../numberInput";

/**
 * A numeric text field with inline range/format validation, shared across
 * dialogs (CanyonDialog, TripLogDialog custom fields; adoptable by TopoDialog's
 * hillshade tab and GeoPdfDialog's extent fields).
 *
 * Design (the CANYON-1/CANYON-2/TRIP-1/TRIP-2 fix):
 * - Renders `type="text"` + `inputMode` so there is no native spinbutton (the
 *   widget-inconsistency the UAT flagged) and so paste/IME can't inject junk.
 * - Every keystroke passes through `sanitizeDecimalInput`: letters are dropped,
 *   at most one leading "-" and one "." survive. The decimal point is kept even
 *   for integer fields so that typing "5.5" shows an inline error instead of
 *   being silently truncated to "55" (TRIP-1). Validation, not the sanitizer,
 *   enforces integer-ness.
 * - The inline error appears once the field has been blurred, or immediately
 *   when the parent sets `showError` (on a Save attempt, so every invalid field
 *   lights up at once). Parents block Save by re-running `numericFieldError`
 *   with the same constraints — validity is never hidden in component state.
 *
 * `value` is a controlled string; `""` means unset (the parent decides whether
 * the field is required — this component treats empty as valid).
 */
export type ValidatedNumberFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Range/format rules. Empty value is always allowed. */
  constraints: NumericFieldConstraints;
  /** Force the error to show even before the field is blurred (Save attempt). */
  showError?: boolean;
  /** Optional info tooltip rendered as a trailing adornment. */
  tooltip?: ReactNode;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  fullWidth?: boolean;
  sx?: SxProps<Theme>;
};

export function ValidatedNumberField({
  label,
  value,
  onChange,
  constraints,
  showError = false,
  tooltip,
  disabled,
  required,
  placeholder,
  fullWidth = true,
  sx,
}: ValidatedNumberFieldProps) {
  const [touched, setTouched] = useState(false);
  const error = numericFieldError(value, constraints);
  const visibleError = (touched || showError) && error ? error : null;

  return (
    <div style={{ width: fullWidth ? "100%" : undefined }}>
      <TextField
        label={label}
        value={value}
        onChange={(e) => onChange(sanitizeDecimalInput(e.target.value))}
        onBlur={() => setTouched(true)}
        type="text"
        inputMode={constraints.integer ? "numeric" : "decimal"}
        error={visibleError != null}
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        size="small"
        fullWidth={fullWidth}
        sx={sx}
        InputProps={
          tooltip
            ? {
                endAdornment: (
                  <InputAdornment position="end">
                    <Tooltip title={tooltip} placement="top" arrow>
                      <InfoOutlinedIcon
                        sx={{
                          fontSize: "1rem",
                          color: "var(--theme-text-muted)",
                          cursor: "help",
                        }}
                      />
                    </Tooltip>
                  </InputAdornment>
                ),
              }
            : undefined
        }
      />
      <FieldError message={visibleError} />
    </div>
  );
}

export default ValidatedNumberField;
