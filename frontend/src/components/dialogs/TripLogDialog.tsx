import { useState, useEffect, useRef } from "react";
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
  CircularProgress,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { ErrorBanner } from "../feedback/ErrorBanner";
import type { TripLogCustomFieldDef, TripLogCustomFieldType, MediaItem } from "@logjam/shared";
import { makeCustomFieldKey, coerceFieldValue } from "@logjam/shared";
import type { TTripLog } from "../../canyonUtils";
import {
  createTripLog,
  updateTripLog,
  deleteTripLog,
  getTripLog,
  updateUserPreferences,
} from "../../canyonUtils";
import { messageFromError } from "../../errors/messageFromError";
import { fieldSx } from "../../csvImport/dialogStyles";
import MediaUpload from "../media/MediaUpload";
import MediaGallery from "../media/MediaGallery";
import AddCustomFieldForm from "./AddCustomFieldForm";
import CustomFieldInput from "./CustomFieldInput";
import { getFieldValue as getFieldValueFor } from "./customFieldValues";
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

  // Media. In edit mode the trip already exists; in create mode we lazily
  // materialise a draft trip on first upload so files have something to link to.
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [draftTripId, setDraftTripId] = useState<string | null>(null);
  // Set once the trip has been saved/committed, so closing won't delete it.
  const committedRef = useRef(false);
  // De-dupes concurrent draft creation when several files upload at once.
  const draftPromiseRef = useRef<Promise<string> | null>(null);

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
    // Reset media/draft tracking each time the dialog opens.
    setMedia([]);
    setDraftTripId(null);
    committedRef.current = false;
    draftPromiseRef.current = null;
  }, [open, tripLog?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // In edit mode, fetch the trip's existing media (with fresh presigned URLs).
  useEffect(() => {
    if (!open || !tripLog) return;
    const { canyonId: tripCanyonId, id } = tripLog;
    setMediaLoading(true);
    getTripLog(tripCanyonId, id)
      .then((full) => setMedia(full.media ?? []))
      .catch((err) => {
        console.error(err);
        setError(messageFromError(err, "Couldn't load trip files."));
      })
      .finally(() => setMediaLoading(false));
  }, [open, tripLog?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The trip id media should link to: a real trip in edit mode, otherwise a
  // draft created on first upload. Guarded so concurrent uploads create one trip.
  function ensureLinkedTripId(): Promise<string> {
    if (tripLog) return Promise.resolve(tripLog.id);
    if (draftTripId) return Promise.resolve(draftTripId);
    if (draftPromiseRef.current) return draftPromiseRef.current;

    const customFields: Record<string, unknown> = {};
    for (const def of customFieldDefs) {
      customFields[def.key] = coerceFieldValue(getFieldValue(def.key), def.type);
    }
    const promise = createTripLog(canyonId, {
      date,
      notes: notes || null,
      customFields,
    })
      .then((trip) => {
        setDraftTripId(trip.id);
        return trip.id;
      })
      .catch((err) => {
        draftPromiseRef.current = null;
        throw err;
      });
    draftPromiseRef.current = promise;
    return promise;
  }

  function handleMediaUploaded(item: MediaItem) {
    setMedia((prev) => [...prev, item]);
  }

  function handleMediaDeleted(id: string) {
    setMedia((prev) => prev.filter((m) => m.id !== id));
  }

  // Cancel/close. If a draft trip was materialised but never saved, delete it
  // (cascades its media from S3 + DB + quota) before closing.
  async function handleRequestClose() {
    if (saving) return;
    if (draftTripId && !committedRef.current) {
      try {
        await deleteTripLog(canyonId, draftTripId);
      } catch (err) {
        console.error(err);
        setError(messageFromError(err, "Couldn't discard uploaded files. Please try again."));
        return;
      }
    }
    onClose();
  }

  function getFieldValue(key: string): string {
    return getFieldValueFor(fieldValues, customFieldDefs, key);
  }

  function setFieldValue(key: string, value: string) {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
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
      } else if (draftTripId) {
        // A draft was already created to hold uploaded files — persist the form.
        await updateTripLog(canyonId, draftTripId, { date, notes: notes || null, customFields });
      } else {
        await createTripLog(canyonId, { date, notes: notes || null, customFields });
      }
      committedRef.current = true;
      onSaved();
      onClose();
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't save trip log. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  async function handleAddField() {
    const label = newFieldLabel.trim();
    if (!label) return;
    // Generate a stable key from the label
    const key = makeCustomFieldKey(label);
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
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't save custom field. Please try again."));
    } finally {
      setAddingField(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : () => void handleRequestClose()}
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
          onClick={() => void handleRequestClose()}
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
            sx={fieldSx}
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
            sx={fieldSx}
          />

          {/* Custom fields */}
          {customFieldDefs.length > 0 && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Custom Fields
              </Typography>
              {customFieldDefs.map((def) => (
                <CustomFieldInput
                  key={def.key}
                  def={def}
                  value={getFieldValue(def.key)}
                  onChange={(v) => setFieldValue(def.key, v)}
                />
              ))}
            </Box>
          )}

          {/* Add custom field */}
          {showAddField ? (
            <AddCustomFieldForm
              entityNoun="trip logs"
              label={newFieldLabel}
              onLabelChange={setNewFieldLabel}
              type={newFieldType}
              onTypeChange={setNewFieldType}
              onAdd={handleAddField}
              onCancel={() => { setShowAddField(false); setNewFieldLabel(""); }}
              adding={addingField}
            />
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

          {/* Media. In create mode the first upload lazily creates a draft trip
              to link files to; cancelling deletes it (and its files). */}
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Photos, Videos &amp; Files
            </Typography>
            <div className={classes.mediaScroll}>
              {mediaLoading ? (
                <Typography variant="body2" sx={{ color: "var(--theme-text-muted)", fontStyle: "italic" }}>
                  Loading files…
                </Typography>
              ) : (
                <MediaGallery
                  media={media}
                  canDelete
                  onDeleted={handleMediaDeleted}
                  emptyText="No photos or files yet."
                />
              )}
              <MediaUpload
                linkedType="tripLog"
                linkedId={tripLog ? tripLog.id : ""}
                resolveLinkedId={tripLog ? undefined : ensureLinkedTripId}
                onUploaded={handleMediaUploaded}
                disabled={saving}
              />
            </div>
          </Box>

          {error && <ErrorBanner message={error} />}
        </Box>
      </DialogContent>

      <DialogActions>
        <Button
          onClick={() => void handleRequestClose()}
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
