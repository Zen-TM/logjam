import { Checkbox, FormControlLabel, TextField } from "@mui/material";
import type { TripLogCustomFieldDef } from "@logjam/shared";
import { customFieldDisplayLabel } from "@logjam/shared";
import { fieldSx } from "../../csvImport/dialogStyles";
import { sanitizeNumericInput } from "../../numberInput";

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
}: {
  def: TripLogCustomFieldDef;
  value: string;
  onChange: (value: string) => void;
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

  const isNumeric = def.type === "integer" || def.type === "float";

  // Bounded numeric fields clamp to [min, max] on blur so a value outside the
  // declared range can't be saved (e.g. a 1-5 field can't hold 6).
  function clampToBounds() {
    if (!isNumeric || def.min == null || def.max == null) return;
    if (value === "" || value === "-") return;
    const n = def.type === "integer" ? parseInt(value, 10) : parseFloat(value);
    if (Number.isNaN(n)) return;
    const clamped = Math.min(def.max, Math.max(def.min, n));
    if (clamped !== n) onChange(String(clamped));
  }

  return (
    <TextField
      key={def.key}
      label={customFieldDisplayLabel(def)}
      value={value}
      onChange={(e) =>
        onChange(
          isNumeric
            ? sanitizeNumericInput(
                e.target.value,
                def.type as "integer" | "float",
              )
            : e.target.value,
        )
      }
      onBlur={isNumeric ? clampToBounds : undefined}
      type={def.type === "date" ? "date" : "text"}
      inputMode={
        def.type === "integer"
          ? "numeric"
          : def.type === "float"
            ? "decimal"
            : undefined
      }
      size="small"
      fullWidth
      InputLabelProps={def.type === "date" ? { shrink: true } : undefined}
      sx={fieldSx}
    />
  );
}

export default CustomFieldInput;
