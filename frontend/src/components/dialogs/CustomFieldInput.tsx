import { Checkbox, FormControlLabel, TextField } from "@mui/material";
import type { TripLogCustomFieldDef } from "@logjam/shared";
import { fieldSx } from "../../csvImport/dialogStyles";

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
        label={def.label}
        sx={{ color: "var(--theme-text-primary)" }}
      />
    );
  }

  return (
    <TextField
      key={def.key}
      label={def.label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      type={def.type === "integer" || def.type === "float" ? "number" : def.type === "date" ? "date" : "text"}
      size="small"
      fullWidth
      InputLabelProps={def.type === "date" ? { shrink: true } : undefined}
      slotProps={
        def.type === "integer"
          ? { htmlInput: { step: 1 } }
          : def.type === "float"
            ? { htmlInput: { step: "any" } }
            : undefined
      }
      sx={fieldSx}
    />
  );
}

export default CustomFieldInput;
