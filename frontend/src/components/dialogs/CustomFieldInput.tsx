import { Checkbox, FormControlLabel, TextField } from "@mui/material";
import type { TripLogCustomFieldDef } from "@logjam/shared";
import { customFieldDisplayLabel } from "@logjam/shared";
import { fieldSx } from "../../csvImport/dialogStyles";
import { numericFieldError, type NumericFieldConstraints } from "../../numberInput";
import ValidatedNumberField from "./ValidatedNumberField";

/**
 * Numeric constraints for a custom field. Integer-ness comes from the field
 * type; the declared min/max (only present on "bounded" fields) become the
 * range. Unbounded numeric custom fields have no range — a temperature integer
 * can legitimately be negative — so only whole-number-ness is enforced there.
 */
function customFieldConstraints(
  def: TripLogCustomFieldDef,
): NumericFieldConstraints {
  return { integer: def.type === "integer", min: def.min, max: def.max };
}

/**
 * Inline validation error for a custom field's raw string value, or null.
 * Only numeric (integer/float) fields can be invalid. Used by both the input
 * below (to render the error) and the dialogs (to block Save). Pure.
 */
export function customFieldValueError(
  def: TripLogCustomFieldDef,
  value: string,
): string | null {
  if (def.type !== "integer" && def.type !== "float") return null;
  return numericFieldError(value, customFieldConstraints(def));
}

/**
 * A single custom-field input, shared between CanyonDialog and TripLogDialog
 * (UX-002/UX-003: shared TextField styling so both dialogs' custom-field
 * inputs are pixel-identical).
 *
 * `value` is expected to come from `customFieldValues.getFieldValue`, which
 * defaults unset boolean fields to "false" (UX-004) so the checkbox below
 * and the persisted value agree.
 */
function CustomFieldInput({
  def,
  value,
  onChange,
  showError = false,
}: {
  def: TripLogCustomFieldDef;
  value: string;
  onChange: (value: string) => void;
  // Force the inline error to show even before blur (Save attempt).
  showError?: boolean;
}) {
  if (def.type === "boolean") {
    return (
      <FormControlLabel
        key={def.key}
        control={
          <Checkbox
            checked={value === "true"}
            onChange={(e) => onChange(String(e.target.checked))}
            sx={{ color: "var(--theme-text-muted)" }}
          />
        }
        label={customFieldDisplayLabel(def)}
        sx={{ color: "var(--theme-text-primary)" }}
      />
    );
  }

  if (def.type === "integer" || def.type === "float") {
    // Validated numeric field: a decimal typed into an integer field shows an
    // inline "Whole numbers only" error instead of being silently truncated
    // (TRIP-1), and out-of-range values on bounded fields are flagged instead
    // of silently clamped (TRIP-2).
    return (
      <ValidatedNumberField
        label={customFieldDisplayLabel(def)}
        value={value}
        onChange={onChange}
        constraints={customFieldConstraints(def)}
        showError={showError}
        sx={fieldSx}
      />
    );
  }

  return (
    <TextField
      key={def.key}
      label={customFieldDisplayLabel(def)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      type={def.type === "date" ? "date" : "text"}
      size="small"
      fullWidth
      InputLabelProps={def.type === "date" ? { shrink: true } : undefined}
      sx={fieldSx}
    />
  );
}

export default CustomFieldInput;
