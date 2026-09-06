import { useState, useEffect, useMemo, useRef } from "react";
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
import type { ScopedCustomFieldDef, TripLogCustomFieldType, MediaItem } from "@logjam/shared";
import {
  coerceFieldValue,
  mediaCategory,
  buildCustomFieldDef,
  fieldValue,
  numericFieldValue,
  setFieldValues as withFieldValues,
  SOURCES_FIELD_KEY,
  SYSTEM_FIELD_DEFS,
  SYSTEM_PLACE_TYPE_IDS,
  RESERVED_FIELD_KEYS,
  defsForType,
  LATITUDE_RANGE,
  LONGITUDE_RANGE,
  isValidLatitude,
  isValidLongitude,
} from "@logjam/shared";
import { numericFieldError, type NumericFieldConstraints } from "../../numberInput";
import type { TPlaceType } from "../../placeUtils";
import ValidatedNumberField from "./ValidatedNumberField";
import type { TPlace } from "../../placeUtils";
import {
  updatePlace,
  createPlace,
  deletePlace,
  getPlaceDetail,
  createCustomField,
  isHttpUrl,
} from "../../placeUtils";
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

// Adapt a system field definition's bounds to the frontend field shape. The
// hardcoded PLACE_NUMERIC_CONSTRAINTS table this used to read is gone — the
// bounds now live on the DEFINITIONS, which is the only place they are declared.
/** A field value as the string an input wants, or "" when unset. */
function stringFieldValueOf(place: TPlace, key: string): string {
  const value = fieldValue(place.fieldValues, key);
  return value != null ? String(value) : "";
}

function fieldConstraints(key: string): NumericFieldConstraints {
  const def = SYSTEM_FIELD_DEFS.find((d) => d.key === key);
  if (!def) throw new Error(`no system field definition keyed ${key}`);
  return {
    integer: def.type === "integer",
    min: def.min ?? undefined,
    max: def.max ?? undefined,
  };
}

// ponytail: this dialog still writes CANYONS ONLY, and the seven grade inputs
// below are still hardcoded rather than rendered from the chosen type's
// definitions. The web UI is phase 6 of the places rework, where the type
// picker and the generic field form land together with the type-management
// screens they need to sit beside; doing half of it here would mean a picker
// with nothing to pick. Until then the web creates canyons and the phone
// creates anything — stated so the gap is a decision, not an oversight.

const LAT_CONSTRAINTS: NumericFieldConstraints = {
  min: LATITUDE_RANGE.min,
  max: LATITUDE_RANGE.max,
};
const LNG_CONSTRAINTS: NumericFieldConstraints = {
  min: LONGITUDE_RANGE.min,
  max: LONGITUDE_RANGE.max,
};

function PlaceDialog({
  place,
  open,
  onClose,
  onSaved,
  onPickCoords,
  onCancelPickCoords,
  customFieldDefs,
  onCustomFieldDefsChange,
  placeTypes,
  onMediaChanged,
}: {
  place: TPlace | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onPickCoords: (onPicked: (lat: number, lng: number) => void) => void;
  onCancelPickCoords: () => void;
  /** SCOPED definitions: which types each appears on decides which fields this
   *  form has at all. */
  customFieldDefs: ScopedCustomFieldDef[];
  onCustomFieldDefsChange: (defs: ScopedCustomFieldDef[]) => void;
  /** The types the user may file a place under — their own plus the system
   *  three. Always ALL of them here, including empty ones: a picker that hid
   *  a type with no places in it could never be used to make the first one. */
  placeTypes: TPlaceType[];
  // Called after a media/track upload or delete so the opener (place detail
  // panel) can refresh its slideshow/track without waiting for a Save.
  onMediaChanged?: () => void;
}) {
  const isEdit = place != null;

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
  // THE TYPE, chosen first. It decides which fields the form below has, so it
  // sits at the top of the dialog rather than among them.
  const [placeTypeId, setPlaceTypeId] = useState<string>(
    SYSTEM_PLACE_TYPE_IDS.canyon,
  );
  const isCanyonType = placeTypeId === SYSTEM_PLACE_TYPE_IDS.canyon;
  /**
   * The fields THIS type has, minus the ones already rendered above.
   *
   * `defsForType` is the shared rule (a definition appears on a type it is
   * scoped to, or on every type when it is flagged) so the phone and the
   * browser cannot disagree about which fields a campsite has. The reserved
   * keys are excluded because the canyon block above renders them with the
   * inputs they deserve — rendering them twice would give a canyon two V Grade
   * boxes writing to one key.
   */
  const typeFieldDefs = useMemo(
    () =>
      defsForType(customFieldDefs, placeTypeId).filter(
        (def) => !isCanyonType || !RESERVED_FIELD_KEYS.has(def.key),
      ),
    [customFieldDefs, placeTypeId, isCanyonType],
  );

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
  const [fieldToDelete, setFieldToDelete] = useState<ScopedCustomFieldDef | null>(null);

  // Media. In edit mode the place exists; in create mode a draft place is
  // lazily materialised on first upload so files have something to link to
  // (mirrors TripLogDialog). Cancel deletes an uncommitted draft.
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [draftPlaceId, setDraftPlaceId] = useState<string | null>(null);
  const committedRef = useRef(false);
  const draftPromiseRef = useRef<Promise<string> | null>(null);

  const pickingRef = useRef(false);
  // First field, focused on a fresh open by the reset effect below.
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Snapshot of the form fields as populated below, taken in the same effect
  // that sets them — used by the unsaved-changes guard to tell a real edit
  // apart from "the dialog is open" (PLACE-3). Sources/fieldValues are
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
    // Editing keeps the place's own type; creating defaults to Canyon, which
    // is what this app is for. Retyping IS allowed on an edit: miscategorising
    // is inevitable, and the server parks any value the new type has no
    // definition for rather than dropping it (§2.6).
    const initialPlaceTypeId = place?.placeTypeId ?? SYSTEM_PLACE_TYPE_IDS.canyon;
    if (place) {
      initialName = place.name;
      initialAltNames = place.altNames.join(", ");
      initialLatitude = String(place.latitude);
      initialLongitude = String(place.longitude);
      initialNotes = place.notes ?? "";
      initialNumAbseils = stringFieldValueOf(place, "num_abseils");
      initialLongestAbseil = stringFieldValueOf(place, "longest_abseil");
      initialVGrade = numericFieldValue(place.fieldValues, "v_grade") ?? "";
      initialAGrade = numericFieldValue(place.fieldValues, "a_grade") ?? "";
      initialCommitment = numericFieldValue(place.fieldValues, "commitment") ?? "";
      initialQuality = stringFieldValueOf(place, "quality");
      initialHours = stringFieldValueOf(place, "hours");
      const storedSources = place.fieldValues?.[SOURCES_FIELD_KEY];
      initialSources = (Array.isArray(storedSources)
        ? (storedSources as [string, string][])
        : []
      ).map(([label, url]) => ({ label, url }));
      // Existing field values as strings. Reads the TOP level of fieldValues —
      // these used to be nested under `attributes.customFields`, and the
      // forward migration hoisted them.
      const vals: Record<string, string> = {};
      for (const def of customFieldDefs) {
        const raw = fieldValue(place.fieldValues, def.key);
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
    setPlaceTypeId(initialPlaceTypeId);
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
      placeTypeId: initialPlaceTypeId,
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
    setDraftPlaceId(null);
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
  }, [open, place]); // eslint-disable-line react-hooks/exhaustive-deps

  // Real dirty-check: current form fields vs. the snapshot taken when the
  // dialog was (re)populated — not just "the dialog is open" (PLACE-3).
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

  // In edit mode, fetch the place's existing media (fresh presigned URLs).
  useEffect(() => {
    if (!open || !place) return;
    const { id } = place;
    setMediaLoading(true);
    getPlaceDetail(id)
      .then((detail) => setMedia(detail.media))
      .catch((err) => {
        console.error(err);
        setError(messageFromError(err, "Couldn't load place media."));
      })
      .finally(() => setMediaLoading(false));
  }, [open, place?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The place id media should link to: the real place in edit mode, otherwise
  // a draft created on first upload. Guarded so concurrent uploads create one.
  function ensureLinkedPlaceId(): Promise<string> {
    if (place) return Promise.resolve(place.id);
    if (draftPlaceId) return Promise.resolve(draftPlaceId);
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
    const promise = createPlace({
      name: name.trim(),
      latitude: parsedLat,
      longitude: parsedLng,
      // A media draft is always a new place, so it takes whatever type the
      // picker is showing.
      placeTypeId,
    })
      .then((created) => {
        setDraftPlaceId(created.id);
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

  // Cancel/close. If a draft place was materialised but never saved, delete it
  // (cascades its media from S3 + DB + quota) before closing.
  async function handleRequestClose() {
    if (saving) return;
    if (!isEdit && draftPlaceId && !committedRef.current) {
      try {
        await deletePlace(draftPlaceId);
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

      // Range/format validation for every numeric field (PLACE-1/PLACE-2).
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

      // The seven grades are FIELD VALUES now, keyed by the system definitions.
      // `setFieldValues` drops the empty ones rather than storing nulls: a
      // stored null renders as a filled-in-but-blank field and satisfies a
      // "has a value" filter.
      const data = {
        name: name.trim(),
        altNames: altNames
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        latitude: parsedLat,
        longitude: parsedLng,
        placeTypeId,
        notes: notes || null,
        fieldValues: withFieldValues(place?.fieldValues ?? {}, {
          ...customFields,
          num_abseils: numAbseils ? parseInt(numAbseils) : null,
          longest_abseil: longestAbseil ? parseFloat(longestAbseil) : null,
          v_grade: vGrade !== "" ? (vGrade as number) : null,
          a_grade: aGrade !== "" ? (aGrade as number) : null,
          commitment: commitment !== "" ? (commitment as number) : null,
          quality: quality ? parseFloat(quality) : null,
          hours: hours ? parseFloat(hours) : null,
          [SOURCES_FIELD_KEY]: cleanSources.length > 0 ? cleanSources : null,
        }),
      };

      if (isEdit) {
        await updatePlace(place.id, data);
      } else if (draftPlaceId) {
        // A draft was already created to hold uploaded media — persist the form.
        await updatePlace(draftPlaceId, data);
      } else {
        await createPlace(data);
      }
      committedRef.current = true;
      onSaved();
      toast.success("Place saved.");
      onClose();
    } catch (err) {
      console.error(err);
      setError(
        messageFromError(err, "Couldn't save place. Please try again."),
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
      // ROW-GRAIN (see the note in placeUtils.ts): the whole-list PATCH is
      // gone, and it would have wiped the scoping off every definition.
      // Scoped to the type this place IS, because that is the form the user
      // was looking at when they added the field.
      const updatedDefs = await createCustomField("place", result.def, {
        placeTypeIds: [placeTypeId],
      });
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

  // The unified delete (server strips the field's values from every place +
  // updates the def list) is handled by DeleteCustomFieldDialog; here we only
  // mirror the removal in local state after it succeeds.
  function handleFieldDeleted(remainingDefs: ScopedCustomFieldDef[]) {
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
        {isEdit ? "Edit Place" : "Add Place"}
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
          {/* TYPE FIRST. It decides what the rest of this form is, so it goes
              above the fields it governs rather than at the bottom with them.
              Offered on an EDIT too: miscategorising is inevitable, and the
              server parks any value the new type has no definition for rather
              than dropping it — retyping is reversible, which is what makes it
              safe to offer. */}
          <TextField
            label="Type"
            value={placeTypeId}
            onChange={(e) => setPlaceTypeId(e.target.value)}
            select
            size="small"
            fullWidth
            sx={selectSx}
            SelectProps={{ MenuProps: menuPaperProps }}
            helperText={
              isEdit && place && placeTypeId !== place.placeTypeId
                ? "Values this type has no field for are kept on the place and can be added to it later."
                : undefined
            }
          >
            {placeTypes.map((type) => (
              <MenuItem key={type.id} value={type.id}>
                {type.name}
              </MenuItem>
            ))}
          </TextField>
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
          {/* THE SEVEN CANYON FIELDS keep their bespoke inputs — the v/a grade
              selects, the French-rating links, the units in the labels. They
              are the Canyon system type's definitions, and a generic renderer
              would turn "v3 a4 III" into three unlabelled number boxes. Every
              OTHER type's fields render generically below, from its
              definitions. */}
          {isCanyonType ? (
          <>
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
          </>
          ) : null}
          <TextField
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            // Already auto-grew, but without a bound — a long place note grew
            // the box forever. Same cap as the trip dialog's notes.
            minRows={2}
            maxRows={NOTES_MAX_ROWS}
            size="small"
          />

          {/* The chosen type's own fields. `typeFieldDefs` is the definitions
              in force for it — scoped to it, or flagged for every type — minus
              the seven above, which have already rendered with the inputs they
              deserve. */}
          {typeFieldDefs.length > 0 && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Custom Fields
              </Typography>
              {typeFieldDefs.map((def) => (
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
              entityNoun="places"
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
              the first upload lazily materialises a draft place to link to. */}
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
              linkedType="place"
              linkedId={place ? place.id : ""}
              resolveLinkedId={place ? undefined : ensureLinkedPlaceId}
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
              linkedType="place"
              linkedId={place ? place.id : ""}
              resolveLinkedId={place ? undefined : ensureLinkedPlaceId}
              onUploaded={handleMediaUploaded}
              disabled={saving}
              disabledReason={
                media.some((m) => mediaCategory(m.mediaType) === "track")
                  ? "This place already has a track. Delete it to add another."
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
          {isEdit ? "Discard changes" : "Discard place"}
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
      entity="place"
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

export default PlaceDialog;
