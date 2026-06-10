import {
  Box,
  Button,
  CircularProgress,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import type { TripLogCustomFieldType } from "@logjam/shared";
import { CUSTOM_FIELD_TYPES } from "@logjam/shared";
import { fieldSx, selectSx, menuPaperProps } from "../../csvImport/dialogStyles";
import classes from "./AddCustomFieldForm.module.css";

/**
 * "New Custom Field" sub-form, shared between CanyonDialog and TripLogDialog
 * (UX-002: bordered box treatment for both; UX-003: shared field/select
 * styling so the type-select dropdown icon matches between dialogs).
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
}: {
  entityNoun: string;
  label: string;
  onLabelChange: (value: string) => void;
  type: TripLogCustomFieldType;
  onTypeChange: (type: TripLogCustomFieldType) => void;
  onAdd: () => void;
  onCancel: () => void;
  adding: boolean;
}) {
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
      <Box sx={{ display: "flex", gap: 1 }}>
        <Button
          variant="contained"
          color="secondary"
          size="small"
          onClick={onAdd}
          disabled={adding || !label.trim()}
        >
          {adding ? <CircularProgress size={16} /> : "Add Field"}
        </Button>
        <Button
          size="small"
          onClick={onCancel}
          disabled={adding}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          Cancel
        </Button>
      </Box>
    </Box>
  );
}

export default AddCustomFieldForm;
