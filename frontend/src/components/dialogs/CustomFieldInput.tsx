import type { TripLogCustomFieldDef } from "@logjam/shared";
import { customFieldDisplayLabel } from "@logjam/shared";
import { numericFieldError, type NumericFieldConstraints } from "../../numberInput";
import { Checkbox, NumberField, TextField } from "../../ui";

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
 * A single attribute's input, shared between PlaceDialog and TripLogDialog so
 * the two cannot drift (UX-002/UX-003). The control is chosen by the
 * definition's TYPE, never by its key.
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
  const label = customFieldDisplayLabel(def);

  if (def.type === "boolean") {
    return <Checkbox label={label} checked={value === "true"} onChange={(next) => onChange(String(next))} />;
  }

  if (def.type === "integer" || def.type === "float") {
    // A decimal typed into an integer field shows "Whole numbers only" instead
    // of being silently truncated (TRIP-1), and an out-of-range value on a
    // bounded field is flagged instead of silently clamped (TRIP-2).
    return (
      <NumberField
        label={label}
        value={value}
        onChange={onChange}
        constraints={customFieldConstraints(def)}
        showError={showError}
      />
    );
  }

  return (
    <TextField
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      type={def.type === "date" ? "date" : "text"}
    />
  );
}

export default CustomFieldInput;
