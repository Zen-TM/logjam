import { useState, useEffect, useRef, useMemo } from "react";
import { useIsMobile } from "../../useIsMobile";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Autocomplete,
  Button,
  IconButton,
  TextField,
  Typography,
  Box,
  Chip,
  CircularProgress,
  createFilterOptions,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { ErrorBanner } from "../feedback/ErrorBanner";
import type { TripLogCustomFieldDef, TripLogCustomFieldType, MediaItem } from "@logjam/shared";
import { coerceFieldValue, buildCustomFieldDef } from "@logjam/shared";
import type { TCanyon, TTripLog } from "../../canyonUtils";
import {
  createTripLog,
  updateTripLog,
  deleteTripLog,
  getTripLog,
  createCanyon,
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

// ── Canyon option union ──────────────────────────────────────
type CanyonOption =
  | { kind: "existing"; canyon: TCanyon }
  | { kind: "no-marker"; name: string }
  | { kind: "create"; name: string };

function getOptionLabel(opt: CanyonOption | string): string {
  if (typeof opt === "string") return opt;
  switch (opt.kind) {
    case "existing":
      return opt.canyon.name;
    case "no-marker":
    case "create":
      return opt.name;
  }
}

const canyonFilter = createFilterOptions<CanyonOption>();

type CreateForm = { name: string; latitude: string; longitude: string };

function TripLogDialog({
  open,
  onClose,
  onSaved,
  canyons,
  defaultCanyonId = null,
  tripLog,
  customFieldDefs,
  onCustomFieldDefsChange,
  onPickCoords,
  onCanyonCreated,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  canyons: TCanyon[];
  // Create-mode default selection (e.g. the canyon whose detail panel opened the
  // dialog). Edit mode always uses the trip's own canyonId. Defaults to None.
  defaultCanyonId?: string | null;
  tripLog?: TTripLog;
  customFieldDefs: TripLogCustomFieldDef[];
  onCustomFieldDefsChange: (defs: TripLogCustomFieldDef[]) => void;
  onPickCoords?: (onPicked: (lat: number, lng: number) => void) => void;
  // Fired when an inline "Create new canyon" makes a real canyon, so the parent
  // can refetch the canyon list/map (otherwise the new marker only shows after a
  // manual refresh).
  onCanyonCreated?: () => void;
}) {
  const isMobile = useIsMobile();
  const [date, setDate] = useState(todayDateString());
  const [notes, setNotes] = useState("");
  const [selectedCanyonId, setSelectedCanyonId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [creating, setCreating] = useState<CreateForm | null>(null);
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
  // Tracks pick-on-map cycle so the reset useEffect skips when returning.
  const pickingRef = useRef(false);

  // Add custom field form state
  const [showAddField, setShowAddField] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState<TripLogCustomFieldType>("string");
  const [newFieldBounded, setNewFieldBounded] = useState(false);
  const [newFieldMin, setNewFieldMin] = useState("");
  const [newFieldMax, setNewFieldMax] = useState("");
  const [addingField, setAddingField] = useState(false);
  const [addFieldError, setAddFieldError] = useState<string | null>(null);

  // Pre-wrap existing canyons as options once
  const existingOptions: CanyonOption[] = useMemo(
    () => canyons.map((c) => ({ kind: "existing" as const, canyon: c })),
    [canyons],
  );

  // The current selection rendered as the Autocomplete value. All three modes
  // (existing marker / named-only / inline-create) are real option values, so
  // the Autocomplete stays the single source of truth — no freeSolo string path
  // to clobber state on blur.
  const canyonValue: CanyonOption | null = useMemo(() => {
    if (creating) return { kind: "create", name: creating.name };
    if (displayName !== null) return { kind: "no-marker", name: displayName };
    if (selectedCanyonId) {
      const c = canyons.find((c) => c.id === selectedCanyonId);
      return c ? { kind: "existing", canyon: c } : null;
    }
    return null;
  }, [creating, displayName, selectedCanyonId, canyons]);

  // Keep a synthetic value present among options so MUI doesn't warn about an
  // out-of-list value; the dropdown contents are governed by filterOptions.
  const canyonOptions: CanyonOption[] = useMemo(
    () =>
      canyonValue && canyonValue.kind !== "existing"
        ? [...existingOptions, canyonValue]
        : existingOptions,
    [existingOptions, canyonValue],
  );

  function clearCanyonSelection() {
    setSelectedCanyonId(null);
    setDisplayName(null);
    setCreating(null);
  }

  // Populate form when opening for edit (or reset on create).
  // We intentionally exclude customFieldDefs from deps — field defs shouldn't
  // reset the form values just because a new field was added mid-session.
  useEffect(() => {
    if (!open) return;
    // Returning from a pick-on-map cycle — don't reset form state.
    if (pickingRef.current) {
      pickingRef.current = false;
      return;
    }
    if (tripLog) {
      setDate(tripLog.date.split("T")[0]);
      setNotes(tripLog.notes ?? "");
      setSelectedCanyonId(tripLog.canyonId);
      setDisplayName(tripLog.canyonId ? null : tripLog.displayName ?? null);
      setCreating(null);
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
      setSelectedCanyonId(defaultCanyonId);
      setDisplayName(null);
      setCreating(null);
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
    const { id } = tripLog;
    setMediaLoading(true);
    getTripLog(id)
      .then((full) => setMedia(full.media ?? []))
      .catch((err) => {
        console.error(err);
        setError(messageFromError(err, "Couldn't load trip files."));
      })
      .finally(() => setMediaLoading(false));
  }, [open, tripLog?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve the trip payload (canyonId + displayName) from the current canyon
  // selection state, potentially creating a new canyon inline.
  async function resolveCanyonPayload(): Promise<{
    canyonId: string | null;
    displayName: string | null;
  }> {
    if (creating) {
      if (!creating.name.trim()) throw new Error("Canyon name is required.");
      const lat = parseFloat(creating.latitude);
      const lng = parseFloat(creating.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng))
        throw new Error("Valid latitude and longitude are required.");
      const c = await createCanyon({
        name: creating.name.trim(),
        latitude: lat,
        longitude: lng,
      });
      onCanyonCreated?.();
      return { canyonId: c.id, displayName: null };
    }
    if (displayName) return { canyonId: null, displayName };
    if (selectedCanyonId) return { canyonId: selectedCanyonId, displayName: null };
    throw new Error("Choose a canyon or name your trip.");
  }

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
    // Draft trips need a displayName or canyonId so the API accepts them.
    const promise = createTripLog({
      date,
      notes: notes || null,
      customFields,
      canyonId: selectedCanyonId,
      displayName: selectedCanyonId ? null : displayName || "Draft",
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
        await deleteTripLog(draftTripId);
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

  function handlePickCoords() {
    if (!onPickCoords) return;
    pickingRef.current = true;
    onPickCoords((lat, lng) => {
      setCreating((prev) =>
        prev
          ? { ...prev, latitude: lat.toFixed(6), longitude: lng.toFixed(6) }
          : { name: "", latitude: lat.toFixed(6), longitude: lng.toFixed(6) },
      );
    });
  }

  async function handleSave() {
    if (!date) {
      setError("Date is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Resolve canyon selection (may create a canyon inline)
      const canyonPayload = await resolveCanyonPayload();

      // Build custom fields object — only include defined fields
      const customFields: Record<string, unknown> = {};
      for (const def of customFieldDefs) {
        const raw = getFieldValue(def.key);
        customFields[def.key] = coerceFieldValue(raw, def.type);
      }

      if (tripLog) {
        await updateTripLog(tripLog.id, {
          date,
          notes: notes || null,
          customFields,
          ...canyonPayload,
        });
      } else if (draftTripId) {
        // A draft was already created to hold uploaded files — persist the form.
        await updateTripLog(draftTripId, {
          date,
          notes: notes || null,
          customFields,
          ...canyonPayload,
        });
      } else {
        await createTripLog({
          date,
          notes: notes || null,
          customFields,
          ...canyonPayload,
        });
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
    const result = buildCustomFieldDef(
      { label: newFieldLabel, type: newFieldType, bounded: newFieldBounded, min: newFieldMin, max: newFieldMax },
      customFieldDefs,
    );
    if ("error" in result) {
      setAddFieldError(result.error);
      return;
    }
    setAddingField(true);
    setAddFieldError(null);
    try {
      const updatedDefs = [...customFieldDefs, result.def];
      await updateUserPreferences({ tripLogCustomFields: updatedDefs });
      onCustomFieldDefsChange(updatedDefs);
      setShowAddField(false);
      setNewFieldLabel("");
      setNewFieldType("string");
      setNewFieldBounded(false);
      setNewFieldMin("");
      setNewFieldMax("");
    } catch (err) {
      console.error(err);
      setAddFieldError(messageFromError(err, "Couldn't save custom field. Please try again."));
    } finally {
      setAddingField(false);
    }
  }

  return (
    <Dialog
      fullScreen={isMobile}
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
        <Typography variant="h6" component="span">
          {tripLog ? "Edit Trip Log" : "Log Trip"}
        </Typography>
        <IconButton
          aria-label="Close dialog"
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
          {/* Canyon — search an existing marker, name the trip with no marker,
             or create a new canyon inline. All three are selectable option
             values (no freeSolo), so MUI never reduces a typed string to null
             and clobbers the selection. The lat/long row below appears when the
             "Create new canyon" option is chosen. */}
          <Autocomplete<CanyonOption, false, false, false>
            options={canyonOptions}
            getOptionLabel={getOptionLabel}
            getOptionKey={(option) =>
              // no-marker and create share the typed text as their label; without
              // distinct keys React reconciles them as one option and leaves stale
              // ghost rows from prior keystrokes.
              option.kind === "existing"
                ? option.canyon.id
                : `${option.kind}:${option.name}`
            }
            value={canyonValue}
            onChange={(_, val) => {
              if (!val) {
                clearCanyonSelection();
                return;
              }
              switch (val.kind) {
                case "existing":
                  setSelectedCanyonId(val.canyon.id);
                  setDisplayName(null);
                  setCreating(null);
                  break;
                case "no-marker":
                  setSelectedCanyonId(null);
                  setDisplayName(val.name);
                  setCreating(null);
                  break;
                case "create":
                  setSelectedCanyonId(null);
                  setDisplayName(null);
                  setCreating((prev) => ({
                    name: val.name,
                    latitude: prev?.latitude ?? "",
                    longitude: prev?.longitude ?? "",
                  }));
                  break;
              }
            }}
            filterOptions={(options, params) => {
              // Filter only real canyons; always re-append fresh synthetic
              // options for the typed text so "no marker" / "create" are offered.
              const existing = options.filter((o) => o.kind === "existing");
              const filtered = canyonFilter(existing, params);
              const input = params.inputValue.trim();
              if (input) {
                filtered.push(
                  { kind: "no-marker", name: input },
                  { kind: "create", name: input },
                );
              }
              return filtered;
            }}
            isOptionEqualToValue={(opt, val) => {
              if (opt.kind !== val.kind) return false;
              if (opt.kind === "existing" && val.kind === "existing")
                return opt.canyon.id === val.canyon.id;
              return getOptionLabel(opt) === getOptionLabel(val);
            }}
            renderOption={(props, option) => {
              const { key, ...rest } = props as React.HTMLAttributes<HTMLLIElement> & { key: string };
              return (
                <li key={key} {...rest}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {getOptionLabel(option)}
                    </span>
                    {option.kind === "no-marker" && (
                      <Chip label="No canyon marker" size="small" sx={{ fontSize: "0.7em", height: 20 }} />
                    )}
                    {option.kind === "create" && (
                      <Chip label="Create new canyon" size="small" color="primary" sx={{ fontSize: "0.7em", height: 20 }} />
                    )}
                  </Box>
                </li>
              );
            }}
            size="small"
            renderInput={(params) => (
              <TextField
                {...params}
                label="Canyon"
                placeholder="Search canyons or name this trip"
                size="small"
                sx={fieldSx}
              />
            )}
            PaperComponent={({ children }) => (
              <Box sx={{ backgroundColor: "var(--theme-primary)", color: "var(--theme-text-primary)", border: "1px solid rgba(255,255,255,0.1)" }}>
                {children}
              </Box>
            )}
            sx={{ "& .MuiInputBase-input": { color: "var(--theme-text-primary)" } }}
          />

          {/* Inline canyon creation — lat/long + pick on map. Name comes from
              the canyon field text; no separate name input. */}
          {creating && (
            <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
              <TextField
                label="Latitude"
                value={creating.latitude}
                onChange={(e) =>
                  setCreating((prev) => (prev ? { ...prev, latitude: e.target.value } : prev))
                }
                size="small"
                sx={{ ...fieldSx, flex: 1 }}
                placeholder="-33.123456"
              />
              <TextField
                label="Longitude"
                value={creating.longitude}
                onChange={(e) =>
                  setCreating((prev) => (prev ? { ...prev, longitude: e.target.value } : prev))
                }
                size="small"
                sx={{ ...fieldSx, flex: 1 }}
                placeholder="150.123456"
              />
              {onPickCoords && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={handlePickCoords}
                  sx={{
                    borderColor: "var(--theme-accent)",
                    color: "var(--theme-accent)",
                    flexShrink: 0,
                    fontSize: "0.75em",
                  }}
                >
                  Pick on map
                </Button>
              )}
            </Box>
          )}

          {/* Date */}
          <TextField
            label="Date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            size="small"
            fullWidth
            required
            error={!date && error === "Date is required."}
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
              onCancel={() => {
                setShowAddField(false);
                setNewFieldLabel("");
                setNewFieldBounded(false);
                setNewFieldMin("");
                setNewFieldMax("");
                setAddFieldError(null);
              }}
              adding={addingField}
              error={addFieldError}
              bounds={{
                bounded: newFieldBounded,
                onBoundedChange: setNewFieldBounded,
                min: newFieldMin,
                onMinChange: setNewFieldMin,
                max: newFieldMax,
                onMaxChange: setNewFieldMax,
              }}
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
              to link files to; cancelling deletes it (and its files). Split into
              photos/videos and tracks, both allowing multiple files. */}
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Photos &amp; Videos
            </Typography>
            <div className={classes.mediaScroll}>
              {mediaLoading ? (
                <Typography variant="body2" sx={{ color: "var(--theme-text-muted)", fontStyle: "italic" }}>
                  Loading files…
                </Typography>
              ) : (
                <MediaGallery
                  media={media}
                  variant="visual"
                  canDelete
                  onDeleted={handleMediaDeleted}
                  emptyText="No photos or videos yet."
                />
              )}
              <MediaUpload
                category="visual"
                linkedType="tripLog"
                linkedId={tripLog ? tripLog.id : ""}
                resolveLinkedId={tripLog ? undefined : ensureLinkedTripId}
                onUploaded={handleMediaUploaded}
                disabled={saving}
              />
            </div>
          </Box>

          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Tracks (GPX/KML)
            </Typography>
            <div className={classes.mediaScroll}>
              {!mediaLoading && (
                <MediaGallery
                  media={media}
                  variant="tracks"
                  canDelete
                  onDeleted={handleMediaDeleted}
                  emptyText="No tracks yet."
                />
              )}
              <MediaUpload
                category="track"
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
