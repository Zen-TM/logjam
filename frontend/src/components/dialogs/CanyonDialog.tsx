import { useState, useEffect, useRef } from "react";
import { useIsMobile } from "../../useIsMobile";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  MenuItem,
  Box,
  CircularProgress,
  IconButton,
  Typography,
  Tooltip,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import type { TripLogCustomFieldDef, TripLogCustomFieldType, MediaItem } from "@logjam/shared";
import {
  coerceFieldValue,
  mediaCategory,
  buildCustomFieldDef,
  CANYON_NUMERIC_CONSTRAINTS,
  LATITUDE_RANGE,
  LONGITUDE_RANGE,
  isValidLatitude,
  isValidLongitude,
  type CanyonNumericFieldName,
} from "@logjam/shared";
import { numericFieldError, type NumericFieldConstraints } from "../../numberInput";
import ValidatedNumberField from "./ValidatedNumberField";
import type { TCanyon } from "../../canyonUtils";
import {
  updateCanyon,
  createCanyon,
  deleteCanyon,
  getCanyonDetail,
  updateUserPreferences,
  isHttpUrl,
} from "../../canyonUtils";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { FieldError } from "../feedback/FieldError";
import { useToast } from "../feedback/ToastProvider";
import { useUnsavedChangesGuard } from "../../useUnsavedChangesGuard";
import AddCustomFieldForm from "./AddCustomFieldForm";
import CustomFieldInput, { customFieldValueError } from "./CustomFieldInput";
import ConfirmDialog from "./ConfirmDialog";
import DeleteCustomFieldDialog from "./DeleteCustomFieldDialog";
import MediaUpload from "../media/MediaUpload";
import MediaGallery from "../media/MediaGallery";
import { getFieldValue as getFieldValueFor } from "./customFieldValues";
import {
  selectSx,
  menuPaperProps,
  touchTargetSx,
  dialogActionButtonSx,
  NOTES_MAX_ROWS,
} from "../../csvImport/dialogStyles";

const V_GRADES = [1, 2, 3, 4, 5, 6, 7] as const;
const A_GRADES = [1, 2, 3, 4, 5, 6, 7] as const;
const COMMITMENTS = [
  { value: 1, label: "I" },
  { value: 2, label: "II" },
  { value: 3, label: "III" },
  { value: 4, label: "IV" },
  { value: 5, label: "V" },
  { value: 6, label: "VI" },
] as const;

type Source = { label: string; url: string };

// Adapt a shared canyon constraint (max: number | null) to the frontend field
// shape (max?: number). Keeps the numeric ranges sourced from @logjam/shared.
function fieldConstraints(name: CanyonNumericFieldName): NumericFieldConstraints {
  const c = CANYON_NUMERIC_CONSTRAINTS[name];
  return { integer: c.integer, min: c.min, max: c.max ?? undefined };
}

const LAT_CONSTRAINTS: NumericFieldConstraints = {
  min: LATITUDE_RANGE.min,
  max: LATITUDE_RANGE.max,
};
const LNG_CONSTRAINTS: NumericFieldConstraints = {
  min: LONGITUDE_RANGE.min,
  max: LONGITUDE_RANGE.max,
};

function CanyonDialog({
  canyon,
  open,
  onClose,
  onSaved,
  onPickCoords,
  onCancelPickCoords,
  customFieldDefs,
  onCustomFieldDefsChange,
  onMediaChanged,
}: {
  canyon: TCanyon | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onPickCoords: (onPicked: (lat: number, lng: number) => void) => void;
  onCancelPickCoords: () => void;
  customFieldDefs: TripLogCustomFieldDef[];
  onCustomFieldDefsChange: (defs: TripLogCustomFieldDef[]) => void;
  // Called after a media/track upload or delete so the opener (canyon detail
  // panel) can refresh its slideshow/track without waiting for a Save.
  onMediaChanged?: () => void;
}) {
  const isEdit = canyon != null;

  const isMobile = useIsMobile();
  const toast = useToast();
  const [name, setName] = useState("");
  const [altNames, setAltNames] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [numAbseils, setNumAbseils] = useState("");
  const [longestAbseil, setLongestAbseil] = useState("");
  const [notes, setNotes] = useState("");
  const [vGrade, setVGrade] = useState<number | "">("");
  const [aGrade, setAGrade] = useState<number | "">("");
  const [commitment, setCommitment] = useState<number | "">("");
  const [quality, setQuality] = useState("");
  const [hours, setHours] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which field failed validation, so the input can show error state + aria-invalid.
  const [invalidField, setInvalidField] = useState<"name" | "coords" | null>(null);
  // Set on a Save attempt so every out-of-range numeric field shows its inline
  // error at once (before that, errors only show after a field is blurred).
  const [showFieldErrors, setShowFieldErrors] = useState(false);

  // Add custom field form state
  const [showAddField, setShowAddField] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState<TripLogCustomFieldType>("string");
  const [newFieldBounded, setNewFieldBounded] = useState(false);
  const [newFieldMin, setNewFieldMin] = useState("");
  const [newFieldMax, setNewFieldMax] = useState("");
  const [addingField, setAddingField] = useState(false);
  const [addFieldError, setAddFieldError] = useState<string | null>(null);

  // Custom-field deletion confirmation
  const [fieldToDelete, setFieldToDelete] = useState<TripLogCustomFieldDef | null>(null);

  // Media. In edit mode the canyon exists; in create mode a draft canyon is
  // lazily materialised on first upload so files have something to link to
  // (mirrors TripLogDialog). Cancel deletes an uncommitted draft.
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [draftCanyonId, setDraftCanyonId] = useState<string | null>(null);
  const committedRef = useRef(false);
  const draftPromiseRef = useRef<Promise<string> | null>(null);

  const pickingRef = useRef(false);
  // First field, focused on a fresh open by the reset effect below.
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Snapshot of the form fields as populated below, taken in the same effect
  // that sets them — used by the unsaved-changes guard to tell a real edit
  // apart from "the dialog is open" (CANYON-3). Sources/fieldValues are
  // compared by JSON value, not identity.
  const initialFormSnapshotRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (pickingRef.current) {
      pickingRef.current = false;
      return;
    }
    let initialName: string;
    let initialAltNames: string;
    let initialLatitude: string;
    let initialLongitude: string;
    let initialNumAbseils: string;
    let initialLongestAbseil: string;
    let initialNotes: string;
    let initialVGrade: number | "";
    let initialAGrade: number | "";
    let initialCommitment: number | "";
    let initialQuality: string;
    let initialHours: string;
    let initialSources: Source[];
    let initialFieldValues: Record<string, string>;
    if (canyon) {
      initialName = canyon.name;
      initialAltNames = canyon.altNames.join(", ");
      initialLatitude = String(canyon.latitude);
      initialLongitude = String(canyon.longitude);
      initialNumAbseils = canyon.numAbseils != null ? String(canyon.numAbseils) : "";
      initialLongestAbseil =
        canyon.longestAbseil != null ? String(canyon.longestAbseil) : "";
      initialNotes = canyon.notes ?? "";
      initialVGrade = canyon.vGrade ?? "";
      initialAGrade = canyon.aGrade ?? "";
      initialCommitment = canyon.commitment ?? "";
      initialQuality = canyon.quality != null ? String(canyon.quality) : "";
      initialHours = canyon.hours != null ? String(canyon.hours) : "";
      initialSources = (canyon.attributes.sources ?? []).map(([label, url]) => ({
        label,
        url,
      }));
      // Populate existing custom field values as strings
      const vals: Record<string, string> = {};
      for (const def of customFieldDefs) {
        const raw = canyon.attributes.customFields?.[def.key];
        vals[def.key] = raw != null ? String(raw) : "";
      }
      initialFieldValues = vals;
    } else {
      initialName = "";
      initialAltNames = "";
      initialLatitude = "";
      initialLongitude = "";
      initialNumAbseils = "";
      initialLongestAbseil = "";
      initialNotes = "";
      initialVGrade = "";
      initialAGrade = "";
      initialCommitment = "";
      initialQuality = "";
      initialHours = "";
      initialSources = [];
      initialFieldValues = {};
    }
    setName(initialName);
    setAltNames(initialAltNames);
    setLatitude(initialLatitude);
    setLongitude(initialLongitude);
    setNumAbseils(initialNumAbseils);
    setLongestAbseil(initialLongestAbseil);
    setNotes(initialNotes);
    setVGrade(initialVGrade);
    setAGrade(initialAGrade);
    setCommitment(initialCommitment);
    setQuality(initialQuality);
    setHours(initialHours);
    setSources(initialSources);
    setFieldValues(initialFieldValues);
    initialFormSnapshotRef.current = JSON.stringify({
      name: initialName,
      altNames: initialAltNames,
      latitude: initialLatitude,
      longitude: initialLongitude,
      numAbseils: initialNumAbseils,
      longestAbseil: initialLongestAbseil,
      notes: initialNotes,
      vGrade: initialVGrade,
      aGrade: initialAGrade,
      commitment: initialCommitment,
      quality: initialQuality,
      hours: initialHours,
      sources: initialSources,
      fieldValues: initialFieldValues,
    });
    setError(null);
    setInvalidField(null);
    setShowFieldErrors(false);
    setShowAddField(false);
    setNewFieldLabel("");
    setNewFieldType("string");
    setNewFieldBounded(false);
    setNewFieldMin("");
    setNewFieldMax("");
    setAddFieldError(null);
    // Reset media/draft tracking each time the dialog opens.
    setMedia([]);
    setDraftCanyonId(null);
    committedRef.current = false;
    draftPromiseRef.current = null;

    // Open ready to type, focusing the first field. Driven from the effect
    // rather than an `autoFocus` prop so it keys off the same pick-on-map guard
    // as the form reset: the return leg of a pick returns early above, so focus
    // is never yanked off the coordinates the user just picked back up to Name
    // (the dialog remounts on that leg — App holds `open` false while picking).
    // Skipped on mobile, where focusing pops the on-screen keyboard over the
    // form before the user has decided to type.
    if (!isMobile) nameInputRef.current?.focus();
  }, [open, canyon]); // eslint-disable-line react-hooks/exhaustive-deps

  // Real dirty-check: current form fields vs. the snapshot taken when the
  // dialog was (re)populated — not just "the dialog is open" (CANYON-3).
  // Media/custom-field-def edits are excluded: both persist immediately
  // (media uploads, and add/delete-field via updateUserPreferences), so
  // they're never "unsaved" by the time a close is attempted.
  const isDirty =
    open &&
    initialFormSnapshotRef.current !== null &&
    JSON.stringify({
      name,
      altNames,
      latitude,
      longitude,
      numAbseils,
      longestAbseil,
      notes,
      vGrade,
      aGrade,
      commitment,
      quality,
      hours,
      sources,
      fieldValues,
    }) !== initialFormSnapshotRef.current;

  const guard = useUnsavedChangesGuard(isDirty, () => void handleRequestClose());

  // In edit mode, fetch the canyon's existing media (fresh presigned URLs).
  useEffect(() => {
    if (!open || !canyon) return;
    const { id } = canyon;
    setMediaLoading(true);
    getCanyonDetail(id)
      .then((detail) => setMedia(detail.media))
      .catch((err) => {
        console.error(err);
        setError(messageFromError(err, "Couldn't load canyon media."));
      })
      .finally(() => setMediaLoading(false));
  }, [open, canyon?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The canyon id media should link to: the real canyon in edit mode, otherwise
  // a draft created on first upload. Guarded so concurrent uploads create one.
  function ensureLinkedCanyonId(): Promise<string> {
    if (canyon) return Promise.resolve(canyon.id);
    if (draftCanyonId) return Promise.resolve(draftCanyonId);
    if (draftPromiseRef.current) return draftPromiseRef.current;

    const parsedLat = parseFloat(latitude);
    const parsedLng = parseFloat(longitude);
    if (!name.trim() || !latitude || !longitude || isNaN(parsedLat) || isNaN(parsedLng)) {
      return Promise.reject(new Error("Enter a name and location before adding media."));
    }
    if (!isValidLatitude(parsedLat) || !isValidLongitude(parsedLng)) {
      return Promise.reject(
        new Error("Enter a valid location (latitude -90 to 90, longitude -180 to 180) before adding media."),
      );
    }
    const promise = createCanyon({
      name: name.trim(),
      latitude: parsedLat,
      longitude: parsedLng,
    })
      .then((created) => {
        setDraftCanyonId(created.id);
        return created.id;
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
    onMediaChanged?.();
  }

  function handleMediaDeleted(id: string) {
    setMedia((prev) => prev.filter((m) => m.id !== id));
    onMediaChanged?.();
  }

  // Cancel/close. If a draft canyon was materialised but never saved, delete it
  // (cascades its media from S3 + DB + quota) before closing.
  async function handleRequestClose() {
    if (saving) return;
    if (!isEdit && draftCanyonId && !committedRef.current) {
      try {
        await deleteCanyon(draftCanyonId);
        onSaved();
      } catch (err) {
        console.error(err);
        setError(messageFromError(err, "Couldn't discard uploaded media. Please try again."));
        return;
      }
    }
    onCancelPickCoords();
    onClose();
  }

  function handlePickCoords() {
    pickingRef.current = true;
    onPickCoords((lat, lng) => {
      setLatitude(String(lat));
      setLongitude(String(lng));
    });
  }

  // Enter-to-submit. Mirrors the Save button's `disabled` condition, because a
  // form still submits on Enter while its submit button is disabled — without
  // this, Enter would be a route around it (a second save mid-flight). The Save
  // button is `type="submit"` with no onClick, so pointer and keyboard share
  // this one path. Field-level validation stays inside handleSave, which
  // already reports name/coords problems through `invalidField`.
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    void handleSave();
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setInvalidField(null);
    try {
      const parsedLat = parseFloat(latitude);
      const parsedLng = parseFloat(longitude);
      if (!name.trim()) {
        // Inline under the Name field (FieldError), not the bottom banner.
        setInvalidField("name");
        setSaving(false);
        return;
      }
      if (!latitude || !longitude || isNaN(parsedLat) || isNaN(parsedLng)) {
        // Inline under the coordinate fields (FieldError), not the bottom banner.
        setInvalidField("coords");
        setSaving(false);
        return;
      }

      // Range/format validation for every numeric field (CANYON-1/CANYON-2).
      // Same short messages the inline FieldErrors render; the top banner just
      // points the user at the highlighted fields.
      const numericInvalid =
        numericFieldError(latitude, LAT_CONSTRAINTS) ??
        numericFieldError(longitude, LNG_CONSTRAINTS) ??
        numericFieldError(quality, fieldConstraints("quality")) ??
        numericFieldError(hours, fieldConstraints("hours")) ??
        numericFieldError(numAbseils, fieldConstraints("numAbseils")) ??
        numericFieldError(longestAbseil, fieldConstraints("longestAbseil"));
      if (numericInvalid) {
        setShowFieldErrors(true);
        setError("Please fix the highlighted fields.");
        setSaving(false);
        return;
      }

      // Custom numeric fields (integer/float) get the same treatment so an
      // invalid value can't reach coerceFieldValue and be silently mangled.
      const customFieldInvalid = customFieldDefs.some(
        (def) => customFieldValueError(def, getFieldValue(def.key)) != null,
      );
      if (customFieldInvalid) {
        setShowFieldErrors(true);
        setError("Please fix the highlighted fields.");
        setSaving(false);
        return;
      }

      // FEUI-012: reject non-http(s) source URLs (javascript:, data:, ...)
      // rather than storing them verbatim to later render as a clickable href.
      const invalidSourceUrl = sources.some(
        (s) => s.url.trim() && !isHttpUrl(s.url.trim()),
      );
      if (invalidSourceUrl) {
        setError("Source URLs must start with http:// or https://.");
        setSaving(false);
        return;
      }

      const cleanSources: [string, string][] = sources
        .filter((s) => s.label.trim())
        .map((s) => [s.label.trim(), s.url.trim()]);

      const customFields: Record<string, unknown> = {};
      for (const def of customFieldDefs) {
        customFields[def.key] = coerceFieldValue(getFieldValue(def.key), def.type);
      }

      const data = {
        name: name.trim(),
        altNames: altNames
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        latitude: parsedLat,
        longitude: parsedLng,
        numAbseils: numAbseils ? parseInt(numAbseils) : null,
        longestAbseil: longestAbseil ? parseFloat(longestAbseil) : null,
        vGrade: vGrade !== "" ? (vGrade as number) : null,
        aGrade: aGrade !== "" ? (aGrade as number) : null,
        commitment: commitment !== "" ? (commitment as number) : null,
        quality: quality ? parseFloat(quality) : null,
        hours: hours ? parseFloat(hours) : null,
        notes: notes || null,
        attributes: {
          ...canyon?.attributes,
          sources: cleanSources.length > 0 ? cleanSources : undefined,
          customFields,
        },
      };

      if (isEdit) {
        await updateCanyon(canyon.id, data);
      } else if (draftCanyonId) {
        // A draft was already created to hold uploaded media — persist the form.
        await updateCanyon(draftCanyonId, data);
      } else {
        await createCanyon(data);
      }
      committedRef.current = true;
      onSaved();
      toast.success("Canyon saved.");
      onClose();
    } catch (err) {
      console.error(err);
      setError(
        messageFromError(err, "Couldn't save canyon. Please try again."),
      );
    } finally {
      setSaving(false);
    }
  }

  function getFieldValue(key: string): string {
    return getFieldValueFor(fieldValues, customFieldDefs, key);
  }

  function setFieldValue(key: string, value: string) {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
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
      await updateUserPreferences({ canyonCustomFields: updatedDefs });
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

  // The unified delete (server strips the field's values from every canyon +
  // updates the def list) is handled by DeleteCustomFieldDialog; here we only
  // mirror the removal in local state after it succeeds.
  function handleFieldDeleted(remainingDefs: TripLogCustomFieldDef[]) {
    const key = fieldToDelete?.key;
    onCustomFieldDefsChange(remainingDefs);
    if (key) {
      setFieldValues((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  return (
    <>
    <Dialog
      fullScreen={isMobile}
      open={open}
      onClose={saving ? undefined : guard.requestClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: "var(--theme-primary)",
          color: "var(--theme-text-primary)",
          "& .MuiInputBase-input": { color: "var(--theme-text-primary)" },
          "& .MuiInputBase-inputMultiline": {
            color: "var(--theme-text-primary)",
          },
          "& .MuiOutlinedInput-notchedOutline": {
            borderColor: "var(--theme-accent)",
          },
          "& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline": {
            borderColor: "var(--theme-accent)",
          },
          "& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline":
            { borderColor: "var(--theme-accent)" },
          "& .MuiInputLabel-root": { color: "var(--theme-text-muted)" },
          "& .MuiInputLabel-root.Mui-focused": { color: "var(--theme-accent)" },
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          pb: 1,
        }}
      >
        {isEdit ? "Edit Canyon" : "Add Canyon"}
        <IconButton
          aria-label="Close dialog"
          size="small"
          onClick={saving ? undefined : guard.requestClose}
          disabled={saving}
          sx={{ ...touchTargetSx, color: "var(--theme-text-primary)" }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      {/* Spans content and actions so Enter reaches the submit button in
          DialogActions. Carries the Paper's flex column through itself so
          DialogContent keeps scrolling inside the dialog (see TripLogDialog). */}
      <Box
        component="form"
        noValidate
        onSubmit={handleSubmit}
        sx={{
          display: "flex",
          flexDirection: "column",
          flex: "1 1 auto",
          minHeight: 0,
        }}
      >
      <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          <div>
            <TextField
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              error={invalidField === "name"}
              // Focused imperatively by the form-reset effect above, which shares
              // the pick-on-map guard.
              inputRef={nameInputRef}
              size="small"
              fullWidth
            />
            <FieldError message={invalidField === "name" ? "Name is required" : null} />
          </div>
          <TextField
            label="Alternative Names (comma-separated)"
            value={altNames}
            onChange={(e) => setAltNames(e.target.value)}
            size="small"
          />
          <div>
            <Box sx={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 2, alignItems: isMobile ? "stretch" : "flex-start" }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <ValidatedNumberField
                  label="Latitude"
                  value={latitude}
                  onChange={setLatitude}
                  constraints={LAT_CONSTRAINTS}
                  required
                  showError={showFieldErrors || invalidField === "coords"}
                  tooltip="WGS84 decimal degrees (standard GPS format). Between -90 and 90."
                />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <ValidatedNumberField
                  label="Longitude"
                  value={longitude}
                  onChange={setLongitude}
                  constraints={LNG_CONSTRAINTS}
                  required
                  showError={showFieldErrors || invalidField === "coords"}
                  tooltip="WGS84 decimal degrees (standard GPS format). Between -180 and 180."
                />
              </Box>
              <Button
                variant="contained"
                color="secondary"
                sx={{
                  whiteSpace: "nowrap",
                  minWidth: "auto",
                  height: "40px",
                }}
                onClick={handlePickCoords}
              >
                📍 Select on Map
              </Button>
            </Box>
            <FieldError
              message={invalidField === "coords" ? "Valid coordinates are required" : null}
            />
          </div>
          <Box sx={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 2 }}>
            <Tooltip
              title={
                <a
                  href="https://ropewiki.com/French_rating"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "inherit" }}
                >
                  Vertical technical difficulty — French rating system ↗
                </a>
              }
              placement="top"
              arrow
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <TextField
                  label="V Grade"
                  value={vGrade}
                  onChange={(e) =>
                    setVGrade(
                      e.target.value === "" ? "" : Number(e.target.value),
                    )
                  }
                  select
                  size="small"
                  fullWidth
                  sx={selectSx}
                  SelectProps={{ MenuProps: menuPaperProps }}
                >
                  <MenuItem value="">None</MenuItem>
                  {V_GRADES.map((v) => (
                    <MenuItem key={v} value={v}>
                      v{v}
                    </MenuItem>
                  ))}
                </TextField>
              </Box>
            </Tooltip>
            <Tooltip
              title={
                <a
                  href="https://ropewiki.com/French_rating"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "inherit" }}
                >
                  Aquatic difficulty of water sections — French rating system ↗
                </a>
              }
              placement="top"
              arrow
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <TextField
                  label="A Grade"
                  value={aGrade}
                  onChange={(e) =>
                    setAGrade(
                      e.target.value === "" ? "" : Number(e.target.value),
                    )
                  }
                  select
                  size="small"
                  fullWidth
                  sx={selectSx}
                  SelectProps={{ MenuProps: menuPaperProps }}
                >
                  <MenuItem value="">None</MenuItem>
                  {A_GRADES.map((a) => (
                    <MenuItem key={a} value={a}>
                      a{a}
                    </MenuItem>
                  ))}
                </TextField>
              </Box>
            </Tooltip>
            <Tooltip
              title={
                <a
                  href="https://ropewiki.com/French_rating"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "inherit" }}
                >
                  Difficulty of escape or retreat once committed — French rating
                  system ↗
                </a>
              }
              placement="top"
              arrow
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <TextField
                  label="Commitment"
                  value={commitment}
                  onChange={(e) =>
                    setCommitment(
                      e.target.value === "" ? "" : Number(e.target.value),
                    )
                  }
                  select
                  size="small"
                  fullWidth
                  sx={selectSx}
                  SelectProps={{ MenuProps: menuPaperProps }}
                >
                  <MenuItem value="">None</MenuItem>
                  {COMMITMENTS.map((c) => (
                    <MenuItem key={c.value} value={c.value}>
                      {c.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Box>
            </Tooltip>
          </Box>
          <Box sx={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 2, alignItems: isMobile ? "stretch" : "flex-start" }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <ValidatedNumberField
                label="Quality (1-5)"
                value={quality}
                onChange={setQuality}
                constraints={fieldConstraints("quality")}
                showError={showFieldErrors}
                tooltip="Subjective overall quality. 1 = unremarkable; 5 = exceptional. Decimals allowed."
              />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <ValidatedNumberField
                label="Hours"
                value={hours}
                onChange={setHours}
                constraints={fieldConstraints("hours")}
                showError={showFieldErrors}
                tooltip="Estimated total trip duration for an average group, car-to-car."
              />
            </Box>
          </Box>
          <Box sx={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 2, alignItems: isMobile ? "stretch" : "flex-start" }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <ValidatedNumberField
                label="Pitches"
                value={numAbseils}
                onChange={setNumAbseils}
                constraints={fieldConstraints("numAbseils")}
                showError={showFieldErrors}
                tooltip="Number of abseils."
              />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <ValidatedNumberField
                label="Longest Pitch (m)"
                value={longestAbseil}
                onChange={setLongestAbseil}
                constraints={fieldConstraints("longestAbseil")}
                showError={showFieldErrors}
                tooltip="Length of the longest single abseil in metres, measured along the rope."
              />
            </Box>
          </Box>
          <TextField
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            // Already auto-grew, but without a bound — a long canyon note grew
            // the box forever. Same cap as the trip dialog's notes.
            minRows={2}
            maxRows={NOTES_MAX_ROWS}
            size="small"
          />

          {/* Custom fields */}
          {customFieldDefs.length > 0 && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Custom Fields
              </Typography>
              {customFieldDefs.map((def) => (
                <Box
                  key={def.key}
                  sx={{ display: "flex", gap: 1, alignItems: "center" }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <CustomFieldInput
                      def={def}
                      value={getFieldValue(def.key)}
                      onChange={(v) => setFieldValue(def.key, v)}
                      showError={showFieldErrors}
                    />
                  </Box>
                  <IconButton
                    aria-label={`Delete custom field ${def.label}`}
                    size="small"
                    onClick={() => setFieldToDelete(def)}
                    sx={{
                      ...touchTargetSx,
                      color: "var(--theme-text-muted)",
                      flexShrink: 0,
                      "&:hover": { color: "var(--theme-warning)" },
                    }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
            </Box>
          )}

          {/* Add custom field */}
          {showAddField ? (
            <AddCustomFieldForm
              entityNoun="canyons"
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
              onClick={() => {
                setAddFieldError(null);
                setShowAddField(true);
              }}
              sx={{
                ...touchTargetSx,
                color: "var(--theme-accent)",
                textTransform: "none",
                alignSelf: "flex-start",
                px: 0,
              }}
            >
              + Add Custom Field
            </Button>
          )}

          <Box>
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              Sources
            </Typography>
            {sources.map((source, i) => (
              <Box
                key={i}
                sx={{ display: "flex", gap: 1, mb: 1, alignItems: "center" }}
              >
                <TextField
                  label="Label"
                  value={source.label}
                  onChange={(e) => {
                    const next = [...sources];
                    next[i] = { ...next[i], label: e.target.value };
                    setSources(next);
                  }}
                  size="small"
                  fullWidth
                />
                <TextField
                  label="URL (optional)"
                  value={source.url}
                  onChange={(e) => {
                    const next = [...sources];
                    next[i] = { ...next[i], url: e.target.value };
                    setSources(next);
                  }}
                  size="small"
                  fullWidth
                />
                <IconButton
                  aria-label="Delete source"
                  size="small"
                  onClick={() => setSources(sources.filter((_, j) => j !== i))}
                  sx={{
                    color: "var(--theme-warning)",
                    flexShrink: 0,
                    width: 32,
                    height: 32,
                  }}
                >
                  ✕
                </IconButton>
              </Box>
            ))}
            <Button
              variant="outlined"
              sx={{
                height: "40px",
                color: "var(--theme-text-primary)",
                borderColor: "var(--theme-accent)",
                "&:hover": {
                  backgroundColor:
                    "color-mix(in srgb, var(--theme-accent) 12%, transparent)",
                },
              }}
              onClick={() => setSources([...sources, { label: "", url: "" }])}
            >
              + Add Source
            </Button>
          </Box>

          {/* Media — photos/videos and a single optional track. In create mode
              the first upload lazily materialises a draft canyon to link to. */}
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Photos &amp; Videos
            </Typography>
            {mediaLoading ? (
              <Typography variant="body2" sx={{ color: "var(--theme-text-muted)", fontStyle: "italic" }}>
                Loading media…
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
              linkedType="canyon"
              linkedId={canyon ? canyon.id : ""}
              resolveLinkedId={canyon ? undefined : ensureLinkedCanyonId}
              onUploaded={handleMediaUploaded}
              disabled={saving}
            />
          </Box>

          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Track (GPX/KML)
            </Typography>
            {!mediaLoading && (
              <MediaGallery
                media={media}
                variant="tracks"
                canDelete
                onDeleted={handleMediaDeleted}
                emptyText="No track yet."
              />
            )}
            <MediaUpload
              category="track"
              maxFiles={1}
              linkedType="canyon"
              linkedId={canyon ? canyon.id : ""}
              resolveLinkedId={canyon ? undefined : ensureLinkedCanyonId}
              onUploaded={handleMediaUploaded}
              disabled={saving}
              disabledReason={
                media.some((m) => mediaCategory(m.mediaType) === "track")
                  ? "This canyon already has a track. Delete it to add another."
                  : undefined
              }
            />
          </Box>

          {error && <ErrorBanner message={error} />}
        </Box>
      </DialogContent>
      <DialogActions>
        {/* Same collision as TripLogDialog: AddCustomFieldForm renders its own
            "Cancel" that only backs out of the sub-form. Name the object. */}
        <Button
          onClick={guard.requestClose}
          disabled={saving}
          sx={{ ...dialogActionButtonSx, color: "var(--theme-text-primary)" }}
        >
          {isEdit ? "Discard changes" : "Discard canyon"}
        </Button>
        {/* type="submit" with no onClick — handleSubmit is the only save path,
            so a click can't fire alongside the form's submit. */}
        <Button
          type="submit"
          variant="contained"
          color="secondary"
          disabled={saving}
          sx={dialogActionButtonSx}
        >
          {saving ? <CircularProgress size={20} /> : "Save"}
        </Button>
      </DialogActions>
      </Box>
    </Dialog>

    <DeleteCustomFieldDialog
      entity="canyon"
      def={fieldToDelete}
      onClose={() => setFieldToDelete(null)}
      onDeleted={handleFieldDeleted}
    />

    <ConfirmDialog
      open={guard.guardOpen}
      title="Discard unsaved changes?"
      message="Your changes will be lost."
      confirmLabel="Discard"
      confirmColor="error"
      onConfirm={guard.confirmDiscard}
      onClose={guard.cancelDiscard}
    />
    </>
  );
}

export default CanyonDialog;
