import { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  TextField,
  Typography,
  Box,
  Checkbox,
  FormControlLabel,
  Select,
  MenuItem,
  CircularProgress,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import type { TripLogCustomFieldDef, TripLogCustomFieldType } from "@logjam/shared";
import { CUSTOM_FIELD_TYPES } from "@logjam/shared";
import type { TTripLog } from "../../canyonUtils";
import {
  createTripLog,
  updateTripLog,
  updateUserPreferences,
} from "../../canyonUtils";
import classes from "./TripLogDialog.module.css";

function todayDateString(): string {
  return new Date().toISOString().split("T")[0];
}

function TripLogDialog({
  open,
  onClose,
  onSaved,
  canyonId,
  canyonName,
  tripLog,
  customFieldDefs,
  onCustomFieldDefsChange,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  canyonId: string;
  canyonName: string;
  tripLog?: TTripLog;
  customFieldDefs: TripLogCustomFieldDef[];
  onCustomFieldDefsChange: (defs: TripLogCustomFieldDef[]) => void;
}) {
  const [date, setDate] = useState(todayDateString());
  const [notes, setNotes] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add custom field form state
  const [showAddField, setShowAddField] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState<TripLogCustomFieldType>("string");
  const [addingField, setAddingField] = useState(false);

  // Populate form when opening for edit (or reset on create).
  // We intentionally exclude customFieldDefs from deps — field defs shouldn't
  // reset the form values just because a new field was added mid-session.
  useEffect(() => {
    if (!open) return;
    if (tripLog) {
      setDate(tripLog.date.split("T")[0]);
      setNotes(tripLog.notes ?? "");
      // Populate existing custom field values as strings
      const vals: Record<string, string> = {};
      for (const def of customFieldDefs) {
        const raw = tripLog.customFields[def.key];
        vals[def.key] = raw != null ? String(raw) : "";
      }
      setFieldValues(vals);
    } else {
      setDate(todayDateString());
      setNotes("");
      setFieldValues({});
    }
    setError(null);
    setShowAddField(false);
    setNewFieldLabel("");
    setNewFieldType("string");
  }, [open, tripLog?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function getFieldValue(key: string): string {
    return fieldValues[key] ?? "";
  }

  function setFieldValue(key: string, value: string) {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  }

  function coerceFieldValue(value: string, type: TripLogCustomFieldType): unknown {
    if (value === "") return null;
    if (type === "integer") return parseInt(value, 10);
    if (type === "float") return parseFloat(value);
    if (type === "boolean") return value === "true";
    return value;
  }

  async function handleSave() {
    if (!date) {
      setError("Date is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Build custom fields object — only include defined fields
      const customFields: Record<string, unknown> = {};
      for (const def of customFieldDefs) {
        const raw = getFieldValue(def.key);
        customFields[def.key] = coerceFieldValue(raw, def.type);
      }

      if (tripLog) {
        await updateTripLog(canyonId, tripLog.id, { date, notes: notes || null, customFields });
      } else {
        await createTripLog(canyonId, { date, notes: notes || null, customFields });
      }
      onSaved();
      onClose();
    } catch {
      setError("Failed to save trip log. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddField() {
    const label = newFieldLabel.trim();
    if (!label) return;
    // Generate a stable key from the label
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (customFieldDefs.some((d) => d.key === key)) {
      setError(`A field with the key "${key}" already exists.`);
      return;
    }
    setAddingField(true);
    setError(null);
    try {
      const newDef: TripLogCustomFieldDef = { key, label, type: newFieldType };
      const updatedDefs = [...customFieldDefs, newDef];
      await updateUserPreferences({ tripLogCustomFields: updatedDefs });
      onCustomFieldDefsChange(updatedDefs);
      setShowAddField(false);
      setNewFieldLabel("");
      setNewFieldType("string");
    } catch {
      setError("Failed to save custom field. Please try again.");
    } finally {
      setAddingField(false);
    }
  }

  function renderCustomField(def: TripLogCustomFieldDef) {
    const value = getFieldValue(def.key);

    if (def.type === "boolean") {
      return (
        <FormControlLabel
          key={def.key}
          control={
            <Checkbox
              checked={value === "true"}
              onChange={(e) => setFieldValue(def.key, String(e.target.checked))}
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
        onChange={(e) => setFieldValue(def.key, e.target.value)}
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
        sx={{
          "& .MuiInputBase-input": { color: "var(--theme-text-primary)", fontSize: "0.9em" },
          "& .MuiInputLabel-root": { color: "var(--theme-text-muted)" },
          "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--theme-accent)" },
        }}
      />
    );
  }

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: "var(--theme-primary)",
          color: "var(--theme-text-primary)",
          maxHeight: "85vh",
        },
      }}
    >
      <DialogTitle
        sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pb: 1 }}
      >
        <Box>
          <Typography variant="h6" component="span">
            {tripLog ? "Edit Trip Log" : "Log Trip"}
          </Typography>
          <Typography
            variant="body2"
            sx={{ color: "var(--theme-text-muted)", mt: 0.25 }}
          >
            {canyonName}
          </Typography>
        </Box>
        <IconButton
          size="small"
          onClick={onClose}
          disabled={saving}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {/* Date */}
          <TextField
            label="Date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            size="small"
            fullWidth
            required
            InputLabelProps={{ shrink: true }}
            sx={{
              "& .MuiInputBase-input": { color: "var(--theme-text-primary)", fontSize: "0.9em" },
              "& .MuiInputLabel-root": { color: "var(--theme-text-muted)" },
              "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--theme-accent)" },
            }}
          />

          {/* Notes */}
          <TextField
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            rows={4}
            size="small"
            fullWidth
            placeholder="Trip notes, conditions, observations..."
            sx={{
              "& .MuiInputBase-input": { color: "var(--theme-text-primary)", fontSize: "0.9em" },
              "& .MuiInputLabel-root": { color: "var(--theme-text-muted)" },
              "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--theme-accent)" },
            }}
          />

          {/* Custom fields */}
          {customFieldDefs.length > 0 && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Custom Fields
              </Typography>
              {customFieldDefs.map(renderCustomField)}
            </Box>
          )}

          {/* Add custom field */}
          {showAddField ? (
            <Box className={classes.addFieldForm}>
              <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                New Custom Field
              </Typography>
              <TextField
                label="Field Label"
                value={newFieldLabel}
                onChange={(e) => setNewFieldLabel(e.target.value)}
                size="small"
                fullWidth
                placeholder="e.g. Group Size"
                sx={{
                  "& .MuiInputBase-input": { color: "var(--theme-text-primary)", fontSize: "0.9em" },
                  "& .MuiInputLabel-root": { color: "var(--theme-text-muted)" },
                  "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--theme-accent)" },
                }}
              />
              <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                <Typography variant="body2" sx={{ color: "var(--theme-text-muted)", flexShrink: 0 }}>
                  Type:
                </Typography>
                <Select
                  value={newFieldType}
                  onChange={(e) => setNewFieldType(e.target.value as TripLogCustomFieldType)}
                  size="small"
                  sx={{
                    color: "var(--theme-text-primary)",
                    fontSize: "0.85em",
                    "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--theme-accent)" },
                    "& .MuiSvgIcon-root": { color: "var(--theme-text-muted)" },
                  }}
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
                  onClick={handleAddField}
                  disabled={addingField || !newFieldLabel.trim()}
                >
                  {addingField ? <CircularProgress size={16} /> : "Add Field"}
                </Button>
                <Button
                  size="small"
                  onClick={() => { setShowAddField(false); setNewFieldLabel(""); }}
                  disabled={addingField}
                  sx={{ color: "var(--theme-text-primary)" }}
                >
                  Cancel
                </Button>
              </Box>
            </Box>
          ) : (
            <Button
              size="small"
              onClick={() => setShowAddField(true)}
              sx={{
                color: "var(--theme-accent)",
                textTransform: "none",
                alignSelf: "flex-start",
                px: 0,
              }}
            >
              + Add Custom Field
            </Button>
          )}

          {/* File uploads — placeholder */}
          <Box className={classes.uploadPlaceholder}>
            <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", mb: 0.5 }}>
              Photos &amp; Videos
            </Typography>
            <Typography variant="body2" sx={{ color: "var(--theme-text-muted)", fontStyle: "italic" }}>
              File uploads coming soon
            </Typography>
          </Box>

          <Box className={classes.uploadPlaceholder}>
            <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", mb: 0.5 }}>
              GPX / Track File
            </Typography>
            <Typography variant="body2" sx={{ color: "var(--theme-text-muted)", fontStyle: "italic" }}>
              File uploads coming soon
            </Typography>
          </Box>

          {error && (
            <Typography variant="body2" sx={{ color: "error.main" }}>
              {error}
            </Typography>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        <Button
          onClick={onClose}
          disabled={saving}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          color="secondary"
          onClick={handleSave}
          disabled={saving || !date}
        >
          {saving ? <CircularProgress size={20} /> : tripLog ? "Save Changes" : "Log Trip"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default TripLogDialog;
