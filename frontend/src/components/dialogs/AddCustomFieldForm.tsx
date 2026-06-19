import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import type { TripLogCustomFieldType } from "@logjam/shared";
import { CUSTOM_FIELD_TYPES } from "@logjam/shared";
import { fieldSx, selectSx, menuPaperProps } from "../../csvImport/dialogStyles";
import { sanitizeNumericInput } from "../../numberInput";
import { ErrorBanner } from "../feedback/ErrorBanner";
import classes from "./AddCustomFieldForm.module.css";

/**
 * "New Custom Field" sub-form, shared between CanyonDialog and TripLogDialog
 * (UX-002: bordered box treatment for both; UX-003: shared field/select
 * styling so the type-select dropdown icon matches between dialogs).
 *
 * Bounds (min/max) are opt-in via the `bounds` prop group. Both CanyonDialog
 * and TripLogDialog pass it. The bounds row only renders for integer/float
 * types.
 */
function AddCustomFieldForm({
  entityNoun,
  label,
  onLabelChange,
  type,
  onTypeChange,
  onAdd,
  onCancel,
  adding,
  error,
  bounds,
}: {
  entityNoun: string;
  label: string;
  onLabelChange: (value: string) => void;
  type: TripLogCustomFieldType;
  onTypeChange: (type: TripLogCustomFieldType) => void;
  onAdd: () => void;
  onCancel: () => void;
  adding: boolean;
  error?: string | null;
  bounds?: {
    bounded: boolean;
    onBoundedChange: (bounded: boolean) => void;
    min: string;
    onMinChange: (value: string) => void;
    max: string;
    onMaxChange: (value: string) => void;
  };
}) {
  const isNumeric = type === "integer" || type === "float";
  const showBounds = bounds != null && isNumeric;
  return (
    <Box className={classes.addFieldForm}>
      <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        New Custom Field
      </Typography>
      <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", fontStyle: "italic" }}>
        This field will be created for all {entityNoun}.
      </Typography>
      <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
        <TextField
          label="Field Label"
          value={label}
          onChange={(e) => onLabelChange(e.target.value)}
          size="small"
          fullWidth
          placeholder="e.g. Group Size"
          sx={fieldSx}
        />
        <Select
          value={type}
          onChange={(e) => onTypeChange(e.target.value as TripLogCustomFieldType)}
          size="small"
          MenuProps={menuPaperProps}
          sx={{ ...selectSx, flexShrink: 0 }}
        >
          {CUSTOM_FIELD_TYPES.map((t) => (
            <MenuItem key={t.value} value={t.value}>
              {t.label}
            </MenuItem>
          ))}
        </Select>
      </Box>
      {showBounds && (
        <Box className={classes.boundsRow}>
          <FormControlLabel
            control={
              <Checkbox
                checked={bounds.bounded}
                onChange={(e) => bounds.onBoundedChange(e.target.checked)}
                sx={{ color: "var(--theme-text-muted)" }}
              />
            }
            label="Bounded?"
            sx={{ color: "var(--theme-text-primary)", mr: 0, flexShrink: 0 }}
          />
          <TextField
            label="Min"
            value={bounds.min}
            onChange={(e) =>
              bounds.onMinChange(
                sanitizeNumericInput(e.target.value, type as "integer" | "float"),
              )
            }
            disabled={!bounds.bounded}
            size="small"
            fullWidth
            inputMode={type === "integer" ? "numeric" : "decimal"}
            sx={fieldSx}
          />
          <TextField
            label="Max"
            value={bounds.max}
            onChange={(e) =>
              bounds.onMaxChange(
                sanitizeNumericInput(e.target.value, type as "integer" | "float"),
              )
            }
            disabled={!bounds.bounded}
            size="small"
            fullWidth
            inputMode={type === "integer" ? "numeric" : "decimal"}
            sx={fieldSx}
          />
        </Box>
      )}
      {error && <ErrorBanner message={error} />}
      <Box className={classes.actionsRow}>
        <Button
          size="small"
          onClick={onCancel}
          disabled={adding}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          color="secondary"
          size="small"
          onClick={onAdd}
          disabled={adding || !label.trim()}
        >
          {adding ? <CircularProgress size={16} /> : "Add Field"}
        </Button>
      </Box>
    </Box>
  );
}

export default AddCustomFieldForm;
